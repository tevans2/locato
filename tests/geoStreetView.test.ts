// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeoStreetView } from "../src/ui/components/GeoStreetView";

const mock = vi.hoisted(() => ({ key: vi.fn(), load: vi.fn(), lookup: vi.fn(), panorama: vi.fn() }));
vi.mock("../src/ui/components/GeoGuessMap", () => ({ googleMapsJavaScriptApiKey: mock.key, loadGoogleMaps: mock.load }));
const location = { countryCode: "IT", label: "Round", lat: 41.9, lng: 12.5, heading: 72, pitch: 4, fov: 90 };
let controllers: AbortController[] = [];
let pov: { setPano: ReturnType<typeof vi.fn>; setPov: ReturnType<typeof vi.fn>; setZoom: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn> };
function setup() { const controller = new AbortController(); controllers.push(controller); return { controller, view: createGeoStreetView(controller.signal) }; }
beforeEach(() => {
  vi.resetAllMocks();
  mock.key.mockReturnValue("test-key");
  pov = { setPano: vi.fn(), setPov: vi.fn(), setZoom: vi.fn(), setVisible: vi.fn() };
  mock.panorama.mockImplementation(function () { return pov; });
  mock.lookup.mockResolvedValue({ data: { location: { pano: "start-pano", latLng: { lat: () => 41.901, lng: () => 12.502 } } } });
  mock.load.mockResolvedValue({ maps: { importLibrary: async () => ({ StreetViewService: class { getPanorama = mock.lookup; }, StreetViewPanorama: mock.panorama }), event: { trigger: vi.fn() } } });
});
afterEach(() => { controllers.forEach(c => c.abort()); controllers = []; vi.useRealTimers(); });

describe("Native GeoGuessr Street View", () => {
  it("uses outdoor coverage, scores from the snapped start and restores the initial view", async () => {
    const { view } = setup();
    await expect(view.show(location)).resolves.toEqual({ lat: 41.901, lng: 12.502 });
    expect(mock.lookup).toHaveBeenCalledWith(expect.objectContaining({ preference: "nearest", sources: ["outdoor"], radius: 1000 }));
    expect(mock.panorama).toHaveBeenCalledWith(view.element, expect.objectContaining({ addressControl: false, showRoadLabels: false, motionTracking: false }));
    pov.setPano.mockClear(); view.reset();
    expect(pov.setPano).toHaveBeenCalledWith("start-pano");
    expect(pov.setPov).toHaveBeenCalledWith({ heading: 72, pitch: 4 });
    expect(pov.setZoom).toHaveBeenCalledWith(1);
    await view.show({ ...location, heading: 12 });
    expect(mock.panorama).toHaveBeenCalledTimes(1);
  });
  it("rejects missing coverage and can retry the same round", async () => {
    mock.lookup.mockResolvedValueOnce({ data: {} });
    const { view } = setup();
    await expect(view.show(location)).rejects.toThrow("No Street View coverage");
    expect(mock.panorama).not.toHaveBeenCalled();
    await expect(view.show(location)).resolves.toEqual({ lat: 41.901, lng: 12.502 });
  });
  it("cancels pending work when the player leaves", async () => {
    mock.lookup.mockReturnValue(new Promise(() => {}));
    const { view, controller } = setup();
    const result = expect(view.show(location)).rejects.toThrow("cancelled");
    controller.abort(); await result;
    expect(mock.panorama).not.toHaveBeenCalled();
  });
  it("times out a stalled request so the game can offer a retry", async () => {
    vi.useFakeTimers();
    mock.lookup.mockReturnValue(new Promise(() => {}));
    const { view } = setup();
    const result = expect(view.show(location)).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(20_000); await result;
    expect(mock.panorama).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer round with a late response", async () => {
    let finish!: (value: unknown) => void;
    mock.lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { view } = setup();
    const first = expect(view.show(location)).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await view.show({ ...location, heading: 90 });
    finish({ data: { location: { pano: "stale", latLng: { lat: () => 0, lng: () => 0 } } } });
    await first;
    expect(pov.setPano).not.toHaveBeenCalledWith("stale");
  });
});
