// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let controllers: AbortController[] = [];
beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY", "test-key"); });
afterEach(() => {
  controllers.forEach(c => c.abort()); controllers = [];
  Reflect.deleteProperty(window, "google");
  document.body.replaceChildren(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
function google() {
  const create = vi.fn();
  const listener = vi.fn();
  const remove = vi.fn();
  const maps = {
    Map: class { constructor() { create(); } addListener = listener.mockReturnValue({ remove }); setCenter() {} setZoom() {} fitBounds() {} },
    LatLngBounds: class { extend() { return this; } }, Polyline: class { setMap() {} },
    event: { trigger: vi.fn() },
    importLibrary: vi.fn(async () => ({ AdvancedMarkerElement: class { map: unknown; constructor(options: { map: unknown }) { this.map = options.map; } } })),
  };
  Object.assign(window, { google: { maps } });
  return { maps, create, listener, remove };
}
async function setup() {
  const { createGeoGuessMap, googleMapsJavaScriptApiKey } = await import("../src/ui/components/GeoGuessMap");
  expect(googleMapsJavaScriptApiKey()).toBe("test-key");
  const controller = new AbortController(); controllers.push(controller);
  const onGuessChange = vi.fn();
  const map = createGeoGuessMap({ signal: controller.signal, onGuessChange });
  document.body.append(map.element);
  return { map, controller, onGuessChange };
}
describe("GeoGuessr guess map", () => {
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
