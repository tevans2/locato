// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeoStreetView } from "../src/ui/components/GeoStreetView";

const mock = vi.hoisted(() => ({ key: vi.fn(), load: vi.fn(), lookup: vi.fn(), panorama: vi.fn() }));
vi.mock("../src/ui/components/GeoGuessMap", () => ({ googleMapsJavaScriptApiKey: mock.key, loadGoogleMaps: mock.load }));
vi.mock("../src/core/map/worldMapData", () => ({ loadWorldCountryFeatures: async () => [{ code: "IT", name: "Italy", continent: "Europe", geometry: { type: "Polygon", coordinates: [[[10,40],[15,40],[15,44],[10,44],[10,40]]] } }] }));
const location = { countryCode: "IT", label: "Round", lat: 41.9, lng: 12.5, heading: 72, pitch: 4, fov: 90 };
let controllers: AbortController[] = [];
let pov: { setPano: ReturnType<typeof vi.fn>; setPov: ReturnType<typeof vi.fn>; setZoom: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn>; getPov: ReturnType<typeof vi.fn>; getZoom: ReturnType<typeof vi.fn>; addListener: ReturnType<typeof vi.fn>; getPano: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
function setup() { const controller = new AbortController(); controllers.push(controller); return { controller, view: createGeoStreetView(controller.signal) }; }
beforeEach(() => {
  vi.resetAllMocks();
  mock.key.mockReturnValue("test-key");
  pov = { setPano: vi.fn(), setPov: vi.fn(), setZoom: vi.fn(), setVisible: vi.fn(), getPov: vi.fn(() => ({ heading: 72, pitch: 4 })), getZoom: vi.fn(() => 1), addListener: vi.fn(() => ({ remove: vi.fn() })), getPano: vi.fn(() => ""), getStatus: vi.fn(() => "OK") };
  pov.setPano.mockImplementation((id: string) => {
    pov.getPano.mockReturnValue(id);
    queueMicrotask(() => pov.addListener.mock.calls.find(([name]) => name === "status_changed")?.[1]());
  });
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
  it("opens real panorama references by ID and uses Google's current GPS", async () => {
    const { view } = setup();
    const { lat: _lat, lng: _lng, ...reference } = location;
    await expect(view.show({ ...reference, panoId: "abcdefghijklmnopqrstuv" })).resolves.toEqual({ lat: 41.901, lng: 12.502 });
    expect(mock.lookup).toHaveBeenCalledWith({ pano: "abcdefghijklmnopqrstuv" });
  });
  it("recovers a replaced ID using original GPS and rejects a different country", async () => {
    const { view } = setup();
    mock.lookup.mockRejectedValueOnce(new Error("ZERO_RESULTS"));
    await expect(view.show({ ...location, panoId: "abcdefghijklmnopqrstuv" })).resolves.toEqual({ lat: 41.901, lng: 12.502 });
    expect(mock.lookup.mock.calls[1]![0]).toMatchObject({ location: { lat: 41.9, lng: 12.5 } });
    mock.lookup.mockResolvedValueOnce({ data: { location: { pano: "elsewhere", latLng: { lat: () => 0, lng: () => 0 } } } });
    await expect(view.show({ ...location, panoId: "abcdefghijklmnopqrstuv" })).rejects.toThrow("outside this country");
    expect(pov.setPano).not.toHaveBeenCalledWith("elsewhere");
  });
  it("updates the compass from the real view and detaches it on exit", async () => {
    const { view, controller } = setup();
    const heading = vi.fn();
    view.onHeadingChange?.(heading);
    await view.show(location);
    const change = pov.addListener.mock.calls[0]![1];
    change();
    expect(heading).toHaveBeenLastCalledWith(72);
    pov.getPov.mockReturnValue({ heading: 195, pitch: 0 });
    change();
    expect(heading).toHaveBeenLastCalledWith(195);
    view.zoomBy?.(1);
    expect(pov.setZoom).toHaveBeenLastCalledWith(2);
    const remove = pov.addListener.mock.results[0]!.value.remove;
    controller.abort();
    expect(remove).toHaveBeenCalledOnce();
  });
  it("waits for the viewer status after coverage lookup, and removes the readiness listener", async () => {
    pov.setPano.mockImplementation((id: string) => { pov.getPano.mockReturnValue(id); });
    const { view } = setup();
    const done = vi.fn();
    const request = view.show(location).then(done);
    await vi.waitFor(() => expect(pov.setVisible).toHaveBeenCalledWith(true));
    expect(done).not.toHaveBeenCalled();
    const index = pov.addListener.mock.calls.findIndex(([name]) => name === "status_changed");
    pov.addListener.mock.calls[index]![1]();
    await request;
    expect(done).toHaveBeenCalledWith({ lat: 41.901, lng: 12.502 });
    expect(pov.addListener.mock.results[index]!.value.remove).toHaveBeenCalledOnce();
  });
  it("handles viewer imagery failure even when coverage lookup succeeded", async () => {
    pov.getStatus.mockReturnValue("ZERO_RESULTS");
    const { view } = setup();
    await expect(view.show(location)).rejects.toThrow("imagery could not load");
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
