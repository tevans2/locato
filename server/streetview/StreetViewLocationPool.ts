import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  emptyStreetViewHistory, mergeStreetViewRounds, rememberStreetViewRounds, selectStreetViewRounds, streetViewCatalog,
  type StreetViewCountryRound, type StreetViewFrame, type StreetViewHistory,
} from "../../src/core/streetview";

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
  readonly containsLocation?: (countryCode: string, lat: number, lng: number) => boolean;
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
const MAX_ROUNDS_PER_BATCH = 20;

const fallbackFrames = streetViewCatalog.flatMap((round) => round.frames.map((frame) => ({ countryCode: round.countryCode, frame })));

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
  private readonly playerHistory = new Map<string, StreetViewHistory>();
  private readonly containsLocation: NonNullable<StreetViewLocationPoolOptions["containsLocation"]>;

  constructor(options: StreetViewLocationPoolOptions) {
    this.storagePath = options.storagePath;
    this.metadataApiKey = options.metadataApiKey?.trim() ?? "";
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.dailyGenerateCount = options.dailyGenerateCount ?? DEFAULT_DAILY_GENERATE_COUNT;
    this.refreshHours = options.refreshHours ?? DEFAULT_REFRESH_HOURS;
    this.metadataRadiusMeters = options.metadataRadiusMeters ?? DEFAULT_METADATA_RADIUS_METERS;
    this.containsLocation = options.containsLocation ?? (() => true);
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
    return (await this.createRounds(1))[0]!;
  }

  async createRounds(count: number, playerId?: string): Promise<StreetViewCountryRound[]> {
    const requestedCount = Number.isFinite(count) ? Math.trunc(count) : 1;
    const safeCount = Math.min(Math.max(requestedCount, 1), MAX_ROUNDS_PER_BATCH);
    const pool = await this.loadPool();
    this.refreshInBackgroundIfNeeded(pool);
    const history = (playerId ? this.playerHistory.get(playerId) : undefined) ?? emptyStreetViewHistory;
    const generated = pool.entries.map((entry) => ({ countryCode: entry.countryCode, frames: [toFrame(entry)] }));
    const rounds = selectStreetViewRounds(mergeStreetViewRounds([...streetViewCatalog, ...generated]), safeCount, { history });
    if (playerId) {
      this.playerHistory.delete(playerId);
      this.playerHistory.set(playerId, rememberStreetViewRounds(history, rounds));
      if (this.playerHistory.size > 500) this.playerHistory.delete(this.playerHistory.keys().next().value!);
    }
    return rounds;
  }

  warm(): void {
    void this.loadPool().then((pool) => this.refreshInBackgroundIfNeeded(pool));
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
    if (!pool.lastGeneratedAt) return true;
    const last = Date.parse(pool.lastGeneratedAt);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= this.refreshHours * 60 * 60 * 1000;
  }

  private async generateAndSave(pool: StreetViewPoolFile): Promise<StreetViewPoolFile> {
    const generated = await this.generateBatch(pool.entries);
    const entries = uniqueEntries([...generated, ...pool.entries]).slice(0, this.maxEntries);
    const updated: StreetViewPoolFile = { version: 1, lastGeneratedAt: new Date().toISOString(), entries };
    await this.savePool(updated);
    return updated;
  }

  private async generateBatch(existingEntries: readonly StreetViewPoolEntry[]): Promise<StreetViewPoolEntry[]> {
    const generated: StreetViewPoolEntry[] = [];
    const seen = new Set([...fallbackFrames.map(({ countryCode, frame }) => duplicateKey(countryCode, frame.lat, frame.lng)),
      ...existingEntries.map((entry) => duplicateKey(entry.countryCode, entry.lat, entry.lng))]);
    const panoramaIds = new Set(existingEntries.map((entry) => entry.panoId));
    const maxAttempts = Math.max(this.dailyGenerateCount * 8, 80);

    for (let attempt = 0; attempt < maxAttempts && generated.length < this.dailyGenerateCount; attempt += 1) {
      const seed = fallbackFrames[Math.floor(Math.random() * fallbackFrames.length)];
      if (!seed) break;
      const candidate = jitterAround(seed.frame);
      const key = duplicateKey(seed.countryCode, candidate.lat, candidate.lng);
      if (seen.has(key) || !this.containsLocation(seed.countryCode, candidate.lat, candidate.lng)) continue;
      const entry = await this.validateCandidate(seed.countryCode, candidate.lat, candidate.lng);
      if (!entry) continue;
      const validatedKey = duplicateKey(entry.countryCode, entry.lat, entry.lng);
      if (seen.has(validatedKey) || (entry.panoId && panoramaIds.has(entry.panoId))) continue;
      seen.add(validatedKey);
      panoramaIds.add(entry.panoId);
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
      const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const data = (await response.json()) as StreetViewMetadataResponse;
      const resolvedLat = data.location?.lat;
      const resolvedLng = data.location?.lng;
      if (data.status !== "OK" || typeof resolvedLat !== "number" || typeof resolvedLng !== "number" || !this.containsLocation(countryCode, resolvedLat, resolvedLng)) return null;
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

  private async loadPool(): Promise<StreetViewPoolFile> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      const data = JSON.parse(raw) as Partial<StreetViewPoolFile>;
      if (data.version !== 1 || !Array.isArray(data.entries)) return emptyPool();
      return { version: 1, lastGeneratedAt: typeof data.lastGeneratedAt === "string" ? data.lastGeneratedAt : null, entries: uniqueEntries(data.entries.filter(isPoolEntry).filter((entry) => this.containsLocation(entry.countryCode, entry.lat, entry.lng))) };
    } catch {
      return emptyPool();
    }
  }

  private async savePool(pool: StreetViewPoolFile): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    const temporaryPath = `${this.storagePath}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(pool, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.storagePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

function uniqueEntries(entries: readonly StreetViewPoolEntry[]): StreetViewPoolEntry[] {
  const locations = new Set<string>();
  const panoramaIds = new Set<string>();
  return entries.filter((entry) => {
    const location = duplicateKey(entry.countryCode, entry.lat, entry.lng);
    if (locations.has(location) || (entry.panoId && panoramaIds.has(entry.panoId))) return false;
    locations.add(location);
    if (entry.panoId) panoramaIds.add(entry.panoId);
    return true;
  });
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
    (entry.panoId === undefined || typeof entry.panoId === "string") &&
    entry.source === "generated"
  );
}
