import type { GeoGuessrLocation } from "../../core/geoguessr";
import type { LngLatPoint } from "../../core/maptap/distance";
import { googleMapsJavaScriptApiKey, loadGoogleMaps } from "./GeoGuessMap";

interface Panorama {
  setPano(id: string): void;
  setPov(pov: { heading: number; pitch: number }): void;
  setZoom(zoom: number): void;
  setVisible(visible: boolean): void;
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
  readonly show: (location: GeoGuessrLocation) => Promise<LngLatPoint>;
  readonly reset: () => void;
  readonly destroy: () => void;
}

export function createGeoStreetView(signal: AbortSignal): GeoStreetView {
  const element = document.createElement("div");
  element.className = "geo-panorama";
  element.setAttribute("aria-label", "Explore the mystery location in Street View");
  let panorama: Panorama | null = null;
  let startingPano = "";
  let startingLocation: GeoGuessrLocation | null = null;
  let requestId = 0;
  let resize: (() => void) | null = null;
  let destroyed = false;
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
    observer.disconnect();
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
      const id = ++requestId;
      const key = googleMapsJavaScriptApiKey();
      if (!key) throw new Error("Street View is not configured.");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let cancel = () => {};
      const stopped = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error("Street View request cancelled."));
        signal.addEventListener("abort", cancel, { once: true });
        timeout = setTimeout(() => reject(new Error("Street View took too long to load.")), 20_000);
      });
      const lookup = async () => {
        const { maps } = await loadGoogleMaps(key);
        if (destroyed || id !== requestId) throw new Error("Street View request cancelled.");
        const library = await maps.importLibrary("streetView") as StreetViewLibrary;
        if (destroyed || id !== requestId) throw new Error("Street View request cancelled.");
        const { data } = await new library.StreetViewService().getPanorama({ location: { lat: location.lat, lng: location.lng }, radius: 1000, preference: "nearest", sources: ["outdoor"] });
        return { maps, library, data };
      };
      const { maps, library, data } = await Promise.race([lookup(), stopped]).finally(() => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      });
      if (destroyed || id !== requestId) throw new Error("Street View request cancelled.");
      if (!data.location?.pano || !data.location.latLng) throw new Error("No Street View coverage at this location.");
      if (!panorama) {
        panorama = new library.StreetViewPanorama(element, {
          addressControl: false, showRoadLabels: false, fullscreenControl: false,
          motionTracking: false, motionTrackingControl: false, panControl: false,
          zoomControl: false, linksControl: true, clickToGo: true, enableCloseButton: false,
        });
        resize = () => { if (panorama) maps.event.trigger(panorama, "resize"); };
      }
      startingLocation = location;
      startingPano = data.location.pano;
      reset();
      panorama.setVisible(true);
      return { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
    },
    reset,
    destroy,
  };
}
