// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let controllers: AbortController[] = [];
beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY", "test-key"); });
afterEach(() => {
  controllers.forEach(c => c.abort()); controllers = [];
  Reflect.deleteProperty(window, "google");
  document.body.replaceChildren(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function google() {
  const create = vi.fn();
  const listener = vi.fn();
  const remove = vi.fn();
  const setMapTypeId = vi.fn();
  const setZoom = vi.fn();
  const setCenter = vi.fn();
  const fitBounds = vi.fn();
  const polygon = vi.fn();
  const marker = vi.fn();
  const line = vi.fn();
  const removeLine = vi.fn();
  const removePolygon = vi.fn();
  const maps = {
    Map: class { constructor(element: HTMLElement, options: unknown) { create(element, options); } addListener = listener.mockReturnValue({ remove }); setCenter = setCenter; setZoom = setZoom; fitBounds = fitBounds; setMapTypeId = setMapTypeId; getZoom = () => 4; },
    LatLngBounds: class { extend() { return this; } }, Polyline: class { constructor(options: unknown) { line(options); } setMap = removeLine; },
    Polygon: class { constructor(options: unknown) { polygon(options); } setMap = removePolygon; },
    event: { trigger: vi.fn() },
    importLibrary: vi.fn(async () => ({ AdvancedMarkerElement: class { map: unknown; constructor(options: { map: unknown }) { this.map = options.map; marker(options); } } })),
  };
  Object.assign(window, { google: { maps } });
  return { maps, create, listener, remove, setMapTypeId, setZoom, setCenter, fitBounds, polygon, removePolygon, marker, line, removeLine };
}
async function setup(revealPadding?: () => { top: number; right: number; bottom: number; left: number }) {
  const { createGeoGuessMap, googleMapsJavaScriptApiKey } = await import("../src/ui/components/GeoGuessMap");
  expect(googleMapsJavaScriptApiKey()).toBe("test-key");
  const controller = new AbortController(); controllers.push(controller);
  const onGuessChange = vi.fn();
  const map = createGeoGuessMap({ signal: controller.signal, onGuessChange, ...(revealPadding ? { revealPadding } : {}) });
  document.body.append(map.element);
  return { map, controller, onGuessChange };
}
describe("GeoGuessr guess map", () => {
  it("keeps even a perfect guess clear of the score overlay and reframes for the recap", async () => {
    const api = google();
    let padding = { top: 120, right: 70, bottom: 240, left: 80 };
    const { map } = await setup(() => padding);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    expect(api.create.mock.calls[0]![1]).toMatchObject({ renderingType: "VECTOR", isFractionalZoomEnabled: true });
    map.reveal({ lat: 42, lng: 12 }, [{ lat: 42, lng: 12, label: "Your pin" }]);
    expect(api.fitBounds.mock.calls.at(-1)?.[1]).toEqual(padding);
    padding = { top: 100, right: 70, bottom: 80, left: 400 };
    map.showResult?.();
    expect(api.fitBounds.mock.calls.at(-1)?.[1]).toEqual(padding);
    expect(api.marker).toHaveBeenCalledTimes(2);
    expect(api.line).toHaveBeenCalledTimes(2);
    map.reset();
    expect(api.create).toHaveBeenCalledOnce();
  });
  it("keeps the outlined route and labelled pins intact while reframing, then clears both line layers", async () => {
    const api = google();
    const { map } = await setup();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    map.reveal({ lat: 40, lng: 12 }, [{ lat: 50, lng: 3, label: "Your pin", color: "#287965" }]);
    expect(api.line.mock.calls[0]![0]).toMatchObject({ strokeColor: "#ffffff", strokeWeight: 7, clickable: false, geodesic: true });
    expect(api.line.mock.calls[1]![0]).toMatchObject({ clickable: false, icons: [expect.objectContaining({ icon: expect.objectContaining({ strokeColor: "#263e34", strokeWeight: 4 }) })] });
    const target = api.marker.mock.calls[0]![0].content as HTMLElement;
    const player = api.marker.mock.calls[1]![0].content as HTMLElement;
    expect(target.getAttribute("aria-label")).toBe("Actual location");
    expect(player.querySelector(".geoguessr-marker-label")?.textContent).toBe("Your pin");
    expect(target.querySelector("svg")?.outerHTML).not.toBe(player.querySelector("svg")?.outerHTML);
    map.showResult?.();
    expect(api.line).toHaveBeenCalledTimes(2);
    map.reset();
    expect(api.removeLine).toHaveBeenCalledTimes(2);
    expect(api.removeLine).toHaveBeenLastCalledWith(null);
  });
  it("switches layers and frames the player's pin without losing it", async () => {
    const api = google();
    const { map } = await setup();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    map.setStyle?.("terrain");
    expect(api.setMapTypeId).toHaveBeenCalledWith("terrain");
    map.setStyle?.("terrain");
    expect(api.setMapTypeId).toHaveBeenCalledOnce();
    map.zoomBy?.(1); expect(api.setZoom).toHaveBeenLastCalledWith(5);
    api.listener.mock.calls[0]![1]({ latLng: { lat: () => 48, lng: () => 2 } });
    map.showWorld?.(); expect(api.setZoom).toHaveBeenLastCalledWith(2);
    map.showGuess?.(); expect(api.setCenter).toHaveBeenLastCalledWith({ lat: 48, lng: 2 });
  });
  it("only draws country outlines after reveal and clears them for the next round", async () => {
    const api = google();
    const feature = { code: "IT", geometry: { type: "Polygon", coordinates: [[[10, 40], [14, 40], [14, 46], [10, 40]]] } };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => [feature] }));
    vi.stubGlobal("fetch", fetcher);
    const { map } = await setup();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    map.highlightCountry?.("IT");
    expect(fetcher).not.toHaveBeenCalled();
    map.reveal({ lat: 42, lng: 12 }, [{ lat: 43, lng: 11, label: "Your pin" }]);
    map.highlightCountry?.("IT");
    await vi.waitFor(() => expect(api.polygon).toHaveBeenCalledOnce());
    expect(api.polygon.mock.calls[0]![0]).toMatchObject({ clickable: false, fillOpacity: 0.16 });
    map.showCountry?.(); expect(api.fitBounds).toHaveBeenCalled();
    map.reset();
    expect(api.removePolygon).toHaveBeenCalledWith(null);
    const calls = api.fitBounds.mock.calls.length;
    map.showCountry?.(); expect(api.fitBounds).toHaveBeenCalledTimes(calls);
  });
  it("discards a delayed outline when the next round has already started", async () => {
    const api = google();
    let finish!: (data: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) })));
    const { map } = await setup();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    map.reveal({ lat: 42, lng: 12 }, []);
    map.highlightCountry?.("IT");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    map.reset();
    finish([{ code: "IT", geometry: { type: "Polygon", coordinates: [[[10, 40], [14, 40], [14, 46], [10, 40]]] } }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.polygon).not.toHaveBeenCalled();
  });
  it("uses a trimmed JavaScript key, with an Embed-key fallback", async () => {
    const { googleMapsJavaScriptApiKey } = await import("../src/ui/components/GeoGuessMap");
    vi.stubEnv("VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY", " browser-key ");
    vi.stubEnv("VITE_GOOGLE_MAPS_EMBED_API_KEY", " fallback-key ");
    expect(googleMapsJavaScriptApiKey()).toBe("browser-key");
    vi.stubEnv("VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY", " ");
    expect(googleMapsJavaScriptApiKey()).toBe("fallback-key");
    vi.stubEnv("VITE_GOOGLE_MAPS_EMBED_API_KEY", "");
    expect(googleMapsJavaScriptApiKey()).toBe("");
  });
  it("retries a failed library load without leaving the guess map stuck", async () => {
    const { maps, create } = google();
    maps.importLibrary.mockRejectedValueOnce(new Error("Network failure"));
    const { map } = await setup();
    await vi.waitFor(() => expect(map.element.querySelector("button")?.textContent).toBe("Retry map"));
    map.element.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(map.element.querySelector<HTMLElement>('[role="status"]')?.hidden).toBe(true);
  });
  it("ignores clicks after submission and removes its listener on exit", async () => {
    const { create, listener, remove } = google();
    const { map, onGuessChange, controller } = await setup();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    const click = listener.mock.calls[0]![1] as (event: unknown) => void;
    const event = { latLng: { lat: () => 25, lng: () => 10 } };
    click(event); expect(onGuessChange).toHaveBeenCalledWith({ lat: 25, lng: 10 });
    map.setAcceptingGuesses(false); click(event); expect(onGuessChange).toHaveBeenCalledOnce();
    controller.abort(); map.destroy(); expect(remove).toHaveBeenCalledOnce();
  });
  it("does not mount a late map after leaving the screen", async () => {
    const { maps, create } = google();
    let finish!: () => void;
    maps.importLibrary.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ AdvancedMarkerElement: class { map: unknown; } }); }));
    const { controller } = await setup();
    controller.abort(); finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(create).not.toHaveBeenCalled();
  });
});
