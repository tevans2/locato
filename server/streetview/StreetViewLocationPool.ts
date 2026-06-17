import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { streetViewCountryRounds, type StreetViewCountryRound, type StreetViewFrame } from "../../src/core/streetview";

interface StreetViewMetadataResponse {
  readonly status?: string;
  readonly pano_id?: string;
  readonly location?: {
    readonly lat?: number;
    readonly lng?: number;
  };
}

export interface StreetViewPoolEntry {
  readonly id: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lng: number;
  readonly heading: number;
  readonly pitch: number;
  readonly fov: number;
  readonly createdAt: string;
  readonly source: "generated";
  readonly panoId?: string;
}

interface StreetViewPoolFile {
  readonly version: 1;
  readonly lastGeneratedAt: string | null;
  readonly entries: readonly StreetViewPoolEntry[];
}

export interface StreetViewLocationPoolOptions {
  readonly storagePath: string;
  readonly metadataApiKey?: string;
  readonly maxEntries?: number;
  readonly dailyGenerateCount?: number;
  readonly refreshHours?: number;
  readonly metadataRadiusMeters?: number;
}

export interface StreetViewLocationPoolStats {
  readonly generatedEntries: number;
  readonly fallbackEntries: number;
  readonly maxEntries: number;
  readonly dailyGenerateCount: number;
  readonly lastGeneratedAt: string | null;
  readonly metadataConfigured: boolean;
  readonly refreshInProgress: boolean;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_DAILY_GENERATE_COUNT = 50;
const DEFAULT_REFRESH_HOURS = 24;
const DEFAULT_METADATA_RADIUS_METERS = 1000;
const EARTH_KM_PER_LATITUDE_DEGREE = 111;
const MAX_ROUNDS_PER_BATCH = 10;

const fallbackFrames = streetViewCountryRounds.flatMap((round) => round.frames.map((frame) => ({ countryCode: round.countryCode, frame })));

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = current;
  }
  return copy;
}

function randomHeading(): number {
  return Math.floor(Math.random() * 360);
}

function createEntryId(countryCode: string, lat: number, lng: number, panoId: string | null): string {
  if (panoId) return `sv_${panoId}`;
  return `sv_${countryCode}_${lat.toFixed(5)}_${lng.toFixed(5)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function duplicateKey(countryCode: string, lat: number, lng: number): string {
  return `${countryCode}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

function jitterAround(frame: StreetViewFrame): { readonly lat: number; readonly lng: number } {
  const radiusKm = 3 + Math.random() * 17;
  const distanceKm = Math.sqrt(Math.random()) * radiusKm;
  const bearing = Math.random() * Math.PI * 2;
  const lat = frame.lat + (Math.cos(bearing) * distanceKm) / EARTH_KM_PER_LATITUDE_DEGREE;
  const lngScale = Math.max(0.25, Math.abs(Math.cos((frame.lat * Math.PI) / 180)));
  const lng = frame.lng + (Math.sin(bearing) * distanceKm) / (EARTH_KM_PER_LATITUDE_DEGREE * lngScale);
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function toFrame(entry: StreetViewPoolEntry): StreetViewFrame {
  return {
    lat: entry.lat,
    lng: entry.lng,
    heading: entry.heading,
    pitch: entry.pitch,
    fov: entry.fov,
    label: "Generated frame",
  };
}

function fallbackRoundForCountry(countryCode: string): StreetViewCountryRound | null {
  return streetViewCountryRounds.find((round) => round.countryCode === countryCode && round.frames.length >= 3) ?? null;
}

function chooseFallbackRound(lastCountryCode: string | null): StreetViewCountryRound {
  const rounds = streetViewCountryRounds.filter((round) => round.frames.length >= 3);
  const available = rounds.length > 1 && lastCountryCode ? rounds.filter((round) => round.countryCode !== lastCountryCode) : rounds;
  const round = available[Math.floor(Math.random() * available.length)] ?? rounds[0];
  if (!round) throw new Error("No fallback Street View country rounds are available.");
  return { countryCode: round.countryCode, frames: shuffle(round.frames).slice(0, 3) };
}

function emptyPool(): StreetViewPoolFile {
  return { version: 1, lastGeneratedAt: null, entries: [] };
}

export class StreetViewLocationPool {
  private readonly storagePath: string;
  private readonly metadataApiKey: string;
  private readonly maxEntries: number;
  private readonly dailyGenerateCount: number;
  private readonly refreshHours: number;
  private readonly metadataRadiusMeters: number;
  private generationPromise: Promise<StreetViewPoolFile> | null = null;
  private lastCountryCode: string | null = null;

  constructor(options: StreetViewLocationPoolOptions) {
    this.storagePath = options.storagePath;
    this.metadataApiKey = options.metadataApiKey?.trim() ?? "";
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.dailyGenerateCount = options.dailyGenerateCount ?? DEFAULT_DAILY_GENERATE_COUNT;
    this.refreshHours = options.refreshHours ?? DEFAULT_REFRESH_HOURS;
    this.metadataRadiusMeters = options.metadataRadiusMeters ?? DEFAULT_METADATA_RADIUS_METERS;
  }

  async stats(): Promise<StreetViewLocationPoolStats> {
    const pool = await this.loadPool();
    return {
      generatedEntries: pool.entries.length,
      fallbackEntries: fallbackFrames.length,
      maxEntries: this.maxEntries,
      dailyGenerateCount: this.dailyGenerateCount,
      lastGeneratedAt: pool.lastGeneratedAt,
      metadataConfigured: this.metadataApiKey.length > 0,
      refreshInProgress: this.generationPromise !== null,
    };
  }

  async createRound(): Promise<StreetViewCountryRound> {
    const pool = await this.loadPool();
    this.refreshInBackgroundIfNeeded(pool);
    return this.createRoundFromPool(pool);
  }

  async createRounds(count: number): Promise<StreetViewCountryRound[]> {
    const requestedCount = Number.isFinite(count) ? Math.trunc(count) : 1;
    const safeCount = Math.min(Math.max(requestedCount, 1), MAX_ROUNDS_PER_BATCH);
    const pool = await this.loadPool();
    this.refreshInBackgroundIfNeeded(pool);
    return Array.from({ length: safeCount }, () => this.createRoundFromPool(pool));
  }

  warm(): void {
    void this.loadPool().then((pool) => this.refreshInBackgroundIfNeeded(pool));
  }

  private createRoundFromPool(pool: StreetViewPoolFile): StreetViewCountryRound {
    const countries = shuffle([...new Set(pool.entries.map((entry) => entry.countryCode))]);
    const availableCountries = this.lastCountryCode && countries.length > 1 ? countries.filter((countryCode) => countryCode !== this.lastCountryCode) : countries;

    for (const countryCode of availableCountries) {
      const round = this.createRoundForCountry(countryCode, pool.entries);
      if (round) {
        this.lastCountryCode = countryCode;
        return round;
      }
    }

    const fallback = chooseFallbackRound(this.lastCountryCode);
    this.lastCountryCode = fallback.countryCode;
    return fallback;
  }

  private refreshInBackgroundIfNeeded(pool: StreetViewPoolFile): void {
    if (this.generationPromise || this.metadataApiKey.length === 0 || !this.shouldRefresh(pool)) return;

    this.generationPromise = this.generateAndSave(pool)
      .catch((error: unknown) => {
        console.warn(JSON.stringify({ time: new Date().toISOString(), level: "warn", action: "streetview.pool.refresh.failed", error: error instanceof Error ? error.message : String(error) }));
        return pool;
      })
      .finally(() => {
        this.generationPromise = null;
      });
  }

  private shouldRefresh(pool: StreetViewPoolFile): boolean {
    if (pool.entries.length === 0) return true;
    if (!pool.lastGeneratedAt) return true;
    const last = Date.parse(pool.lastGeneratedAt);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= this.refreshHours * 60 * 60 * 1000;
  }

  private async generateAndSave(pool: StreetViewPoolFile): Promise<StreetViewPoolFile> {
    const generated = await this.generateBatch(pool.entries);
    const existingKeys = new Set<string>();
    const merged: StreetViewPoolEntry[] = [];

    for (const entry of [...generated, ...pool.entries]) {
      const key = duplicateKey(entry.countryCode, entry.lat, entry.lng);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      merged.push(entry);
      if (merged.length >= this.maxEntries) break;
    }

    const updated: StreetViewPoolFile = { version: 1, lastGeneratedAt: new Date().toISOString(), entries: merged };
    await this.savePool(updated);
    return updated;
  }

  private async generateBatch(existingEntries: readonly StreetViewPoolEntry[]): Promise<StreetViewPoolEntry[]> {
    const generated: StreetViewPoolEntry[] = [];
    const seen = new Set(existingEntries.map((entry) => duplicateKey(entry.countryCode, entry.lat, entry.lng)));
    const maxAttempts = Math.max(this.dailyGenerateCount * 8, 80);

    for (let attempt = 0; attempt < maxAttempts && generated.length < this.dailyGenerateCount; attempt += 1) {
      const seed = fallbackFrames[Math.floor(Math.random() * fallbackFrames.length)];
      if (!seed) break;
      const candidate = jitterAround(seed.frame);
      const key = duplicateKey(seed.countryCode, candidate.lat, candidate.lng);
      if (seen.has(key)) continue;
      const entry = await this.validateCandidate(seed.countryCode, candidate.lat, candidate.lng);
      if (!entry) continue;
      const validatedKey = duplicateKey(entry.countryCode, entry.lat, entry.lng);
      if (seen.has(validatedKey)) continue;
      seen.add(validatedKey);
      generated.push(entry);
    }

    return generated;
  }

  private async validateCandidate(countryCode: string, lat: number, lng: number): Promise<StreetViewPoolEntry | null> {
    const params = new URLSearchParams({
      key: this.metadataApiKey,
      location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
      radius: String(this.metadataRadiusMeters),
      source: "outdoor",
    });

    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`);
      if (!response.ok) return null;
      const data = (await response.json()) as StreetViewMetadataResponse;
      const resolvedLat = data.location?.lat;
      const resolvedLng = data.location?.lng;
      if (data.status !== "OK" || typeof resolvedLat !== "number" || typeof resolvedLng !== "number") return null;
      const panoId = typeof data.pano_id === "string" && data.pano_id.length > 0 ? data.pano_id : null;
      return {
        id: createEntryId(countryCode, resolvedLat, resolvedLng, panoId),
        countryCode,
        lat: Number(resolvedLat.toFixed(6)),
        lng: Number(resolvedLng.toFixed(6)),
        heading: randomHeading(),
        pitch: 0,
        fov: 90,
        createdAt: new Date().toISOString(),
        source: "generated",
        ...(panoId ? { panoId } : {}),
      };
    } catch {
      return null;
    }
  }

  private createRoundForCountry(countryCode: string, entries: readonly StreetViewPoolEntry[]): StreetViewCountryRound | null {
    const generatedFrames = shuffle(entries.filter((entry) => entry.countryCode === countryCode)).map(toFrame);
    const fallback = fallbackRoundForCountry(countryCode);
    const frames = fallback ? [...generatedFrames, ...shuffle(fallback.frames)] : generatedFrames;
    if (frames.length < 3) return null;
    return { countryCode, frames: frames.slice(0, 3) };
  }

  private async loadPool(): Promise<StreetViewPoolFile> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      const data = JSON.parse(raw) as Partial<StreetViewPoolFile>;
      if (data.version !== 1 || !Array.isArray(data.entries)) return emptyPool();
      return { version: 1, lastGeneratedAt: typeof data.lastGeneratedAt === "string" ? data.lastGeneratedAt : null, entries: data.entries.filter(isPoolEntry) };
    } catch {
      return emptyPool();
    }
  }

  private async savePool(pool: StreetViewPoolFile): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, `${JSON.stringify(pool, null, 2)}\n`, "utf8");
  }
}

function isPoolEntry(value: unknown): value is StreetViewPoolEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.countryCode === "string" &&
    typeof entry.lat === "number" &&
    typeof entry.lng === "number" &&
    typeof entry.heading === "number" &&
    typeof entry.pitch === "number" &&
    typeof entry.fov === "number" &&
    typeof entry.createdAt === "string" &&
    entry.source === "generated"
  );
}
