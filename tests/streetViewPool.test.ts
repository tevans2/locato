import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { StreetViewLocationPool } from "../server/streetview";
import { streetViewCatalog, streetViewLocationKey } from "../src/core/streetview";

it("mixes generated locations with the bundled pool and avoids repeats across a player's runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "locato-streetview-"));
  try {
    const storagePath = join(directory, "pool.json");
    const generated = [3.85, 4.05, 5.48].map((lat, index) => ({
      id: `sv_pano-${index}`, panoId: `pano-${index}`, countryCode: "CM", lat, lng: 11.5,
      heading: 90, pitch: 0, fov: 90, source: "generated", createdAt: "2026-11-23T00:00:00Z",
    }));
    await writeFile(storagePath, JSON.stringify({ version: 1, entries: [...generated, { ...generated[0], lat: 4.8 }] }));
    const pool = new StreetViewLocationPool({ storagePath });
    const rounds = [];
    for (let i = 0; i < Math.ceil((streetViewCatalog.length + 1) / 20); i++) {
      rounds.push(...await pool.createRounds(20, "player"));
    }
    const countries = rounds.slice(0, streetViewCatalog.length + 1).map((round) => round.countryCode);
    expect(new Set(countries).size).toBe(streetViewCatalog.length + 1);
    const round = rounds.find(({ countryCode }) => countryCode === "CM")!;
    expect(round.frames.map(streetViewLocationKey).sort()).toEqual(generated.map(streetViewLocationKey).sort());
    expect((await pool.stats()).generatedEntries).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
