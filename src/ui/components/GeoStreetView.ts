import { CountrySampler } from "../../core/geoguessr/CountrySampler";
import { loadWorldCountryFeatures } from "../../core/map/worldMapData";
import type { GeoGuessrCandidate } from "../../core/geoguessr";
import type { LngLatPoint } from "../../core/maptap/distance";
import { googleMapsJavaScriptApiKey, loadGoogleMaps } from "./GeoGuessMap";

let countries: Promise<CountrySampler> | null = null;
function countryBoundaries(): Promise<CountrySampler> {
  return countries ??= loadWorldCountryFeatures().then(world => new CountrySampler(world)).catch(error => { countries = null; throw error; });
}

interface Panorama {
  setPano(id: string): void;
  setPov(pov: { heading: number; pitch: number }): void;
  setZoom(zoom: number): void;
  setVisible(visible: boolean): void;
  getPov(): { heading: number; pitch: number };
  getZoom(): number;
  getPano(): string;
  getStatus(): string;
  addListener(name: "pov_changed" | "status_changed", callback: () => void): { remove(): void };
}
interface StreetViewLibrary {
  StreetViewPanorama: new (element: HTMLElement, options: Record<string, unknown>) => Panorama;
  StreetViewService: new () => {
    getPanorama(request: Record<string, unknown>): Promise<{ data: { location?: { pano?: string; latLng?: { lat(): number; lng(): number } } } }>;
  };
}

export interface GeoStreetView {
  readonly element: HTMLElement;
  /** Returns the snapped starting coordinates used for scoring, never the player's later position. */
  readonly show: (location: GeoGuessrCandidate) => Promise<LngLatPoint>;
  readonly reset: () => void;
  readonly zoomBy?: (delta: number) => void;
  readonly onHeadingChange?: (callback: (heading: number) => void) => () => void;
  readonly destroy: () => void;
}

export function createGeoStreetView(signal: AbortSignal): GeoStreetView {
  const element = document.createElement("div");
  element.className = "geo-panorama";
  element.setAttribute("aria-label", "Explore the mystery location in Street View");
  let panorama: Panorama | null = null;
  let startingPano = "";
  let startingLocation: GeoGuessrCandidate | null = null;
  let requestId = 0;
  let pending: AbortController | null = null;
  let resize: (() => void) | null = null;
  let destroyed = false;
  const headingSubscribers = new Set<(heading: number) => void>();
  let headingListener: { remove(): void } | null = null;
  const observer = new ResizeObserver(() => resize?.());
  observer.observe(element);

  function reset(): void {
    if (!panorama || !startingLocation || !startingPano) return;
    panorama.setPano(startingPano);
    panorama.setPov({ heading: startingLocation.heading, pitch: startingLocation.pitch ?? 0 });
    panorama.setZoom(Math.log2(180 / (startingLocation.fov ?? 90)));
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    requestId += 1;
    pending?.abort();
    observer.disconnect();
    headingListener?.remove();
    headingSubscribers.clear();
    panorama?.setVisible(false);
    panorama = null;
    element.replaceChildren();
  }
  signal.addEventListener("abort", destroy, { once: true });
  if (signal.aborted) destroy();

  return {
    element,
    async show(location) {
      if (destroyed) throw new Error("Street View request cancelled.");
      pending?.abort();
      const request = new AbortController();
      pending = request;
      const id = ++requestId;
      const key = googleMapsJavaScriptApiKey();
      if (!key) throw new Error("Street View is not configured.");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let statusListener: { remove(): void } | null = null;
      let cancel = () => {};
      function checkCurrent(): void {
        if (destroyed || id !== requestId || request.signal.aborted) throw new Error("Street View request cancelled.");
      }
      const stopped = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error("Street View request cancelled."));
        request.signal.addEventListener("abort", cancel, { once: true });
        timeout = setTimeout(() => reject(new Error("Street View took too long to load.")), 20_000);
      });
      const prepare = async (): Promise<LngLatPoint> => {
        const { maps } = await loadGoogleMaps(key);
        checkCurrent();
        const library = await maps.importLibrary("streetView") as StreetViewLibrary;
        checkCurrent();
        const boundaries = location.panoId ? countryBoundaries() : null;
        // Attach a handler while the Google lookup is in flight.
        void boundaries?.catch(() => {});
        const service = new library.StreetViewService();
        const nearby = { location: { lat: location.lat, lng: location.lng }, radius: 1000, preference: "nearest", sources: ["outdoor"] };
        let result;
        try { result = await service.getPanorama(location.panoId ? { pano: location.panoId } : nearby); }
        catch (error) {
          // Historical IDs can change. Only GPS-backed records can recover nearby.
          if (!location.panoId || location.lat === undefined || location.lng === undefined) throw error;
          checkCurrent();
          result = await service.getPanorama(nearby);
        }
        const { data } = result;
        checkCurrent();
        if (!data.location?.pano || !data.location.latLng) throw new Error("No Street View coverage at this location.");
        const origin = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
        if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) throw new Error("Invalid panorama coordinates.");
        if (boundaries && !(await boundaries).contains(location.countryCode, origin.lat, origin.lng)) throw new Error("Street View is outside this country.");
        checkCurrent();
        if (!panorama) {
          panorama = new library.StreetViewPanorama(element, {
            addressControl: false, showRoadLabels: false, fullscreenControl: false,
            motionTracking: false, motionTrackingControl: false, panControl: false,
            zoomControl: false, linksControl: true, clickToGo: true, enableCloseButton: false,
          });
          headingListener = panorama.addListener("pov_changed", () => {
            if (panorama) for (const callback of headingSubscribers) callback(panorama.getPov().heading);
          });
          resize = () => { if (panorama) maps.event.trigger(panorama, "resize"); };
        }
        const view = panorama;
        const panoId = data.location.pano;
        startingLocation = location;
        startingPano = panoId;
        // Service lookup only identifies coverage. Wait for the viewer's own lookup too.
        // Google has no public all-tiles-painted event; the screen's countdown gives its
        // visible, full-size renderer three additional seconds beneath the opaque loader.
        await new Promise<void>((resolve, reject) => {
          const cached = view.getPano() === panoId && view.getStatus() === "OK";
          statusListener = view.addListener("status_changed", () => {
            if (request.signal.aborted || id !== requestId || view.getPano() !== panoId) return;
            const status = view.getStatus();
            if (status === "OK") resolve();
            else if (status === "ZERO_RESULTS" || status === "UNKNOWN_ERROR") reject(new Error("Street View imagery could not load."));
          });
          reset();
          view.setVisible(true);
          // CSS visibility changes between result and loading do not resize the element.
          maps.event.trigger(view, "resize");
          if (cached) resolve();
        });
        checkCurrent();
        return origin;
      };
      try { return await Promise.race([prepare(), stopped]); }
      finally {
        clearTimeout(timeout);
        (statusListener as { remove(): void } | null)?.remove();
        request.signal.removeEventListener("abort", cancel);
        request.abort();
        if (pending === request) pending = null;
      }
    },
    reset,
    zoomBy: delta => { if (panorama) panorama.setZoom(Math.max(0, Math.min(4, panorama.getZoom() + delta))); },
    onHeadingChange: callback => {
      headingSubscribers.add(callback);
      if (panorama) callback(panorama.getPov().heading);
      return () => { headingSubscribers.delete(callback); };
    },
    destroy,
  };
}
