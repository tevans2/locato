import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("shared world map data", () => {
  it("shares one request across concurrent and subsequent game screens", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetcher);
    const { loadWorldCountryFeatures } = await import("../src/core/map/worldMapData");
    const [first, second] = await Promise.all([loadWorldCountryFeatures(), loadWorldCountryFeatures()]);
    expect(first).toBe(second);
    expect(await loadWorldCountryFeatures()).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries after failure instead of caching a rejected request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetcher);
    const { loadWorldCountryFeatures } = await import("../src/core/map/worldMapData");
    await expect(loadWorldCountryFeatures()).rejects.toThrow("503");
    await expect(loadWorldCountryFeatures()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps custom fetchers isolated from the shared cache", async () => {
    const { loadWorldCountryFeatures } = await import("../src/core/map/worldMapData");
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("[]")));
    await loadWorldCountryFeatures(fetcher);
    await loadWorldCountryFeatures(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
