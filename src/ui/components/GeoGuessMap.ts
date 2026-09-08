import type { LngLatPoint } from "../../core/maptap/distance";

const GOOGLE_MAPS_SCRIPT_ID = "locato-google-maps-javascript-api";
const GOOGLE_MAPS_CALLBACK = "__locatoGoogleMapsReady";
const GOOGLE_DEMO_MAP_ID = "DEMO_MAP_ID";

interface GoogleLatLng {
  lat(): number;
  lng(): number;
}

interface GoogleMapMouseEvent {
  readonly latLng: GoogleLatLng | null;
}

interface GoogleMapsListener {
  remove(): void;
}

interface GoogleMapInstance {
  addListener(eventName: "click", handler: (event: GoogleMapMouseEvent) => void): GoogleMapsListener;
  fitBounds(bounds: GoogleLatLngBounds, padding?: number): void;
  setCenter(center: LngLatPoint): void;
  setZoom(zoom: number): void;
}

interface GoogleLatLngBounds {
  extend(point: LngLatPoint): GoogleLatLngBounds;
}

interface GooglePolyline {
  setMap(map: GoogleMapInstance | null): void;
}

interface GoogleAdvancedMarker {
  map: GoogleMapInstance | null;
}

interface GoogleMapsNamespace {
  readonly Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  readonly LatLngBounds: new () => GoogleLatLngBounds;
  readonly Polyline: new (options: Record<string, unknown>) => GooglePolyline;
  readonly event: { trigger(instance: object, eventName: "resize"): void };
  readonly importLibrary: (libraryName: "maps" | "marker" | "streetView") => Promise<unknown>;
}

interface GoogleMarkerLibrary {
  readonly AdvancedMarkerElement: new (options: { readonly map: GoogleMapInstance; readonly position: LngLatPoint; readonly title: string; readonly content: HTMLElement }) => GoogleAdvancedMarker;
}

interface GoogleMapsBundle {
  readonly maps: GoogleMapsNamespace;
  readonly AdvancedMarkerElement: GoogleMarkerLibrary["AdvancedMarkerElement"];
}

interface GoogleWindow extends Window {
  google?: { maps?: GoogleMapsNamespace };
  __locatoGoogleMapsReady?: () => void;
}

let googleMapsPromise: Promise<GoogleMapsBundle> | null = null;

export function googleMapsJavaScriptApiKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY?.trim()
    || import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim()
    || "";
}

async function resolveGoogleMapsBundle(googleWindow: GoogleWindow): Promise<GoogleMapsBundle> {
  const maps = googleWindow.google?.maps;
  if (!maps) throw new Error("Google Maps did not initialize.");
  await maps.importLibrary("maps");
  const markerLibrary = await maps.importLibrary("marker") as GoogleMarkerLibrary;
  return { maps, AdvancedMarkerElement: markerLibrary.AdvancedMarkerElement };
}

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsBundle> {
  if (googleMapsPromise) return googleMapsPromise;
  const googleWindow = window as GoogleWindow;
  if (googleWindow.google?.maps?.importLibrary) {
    googleMapsPromise = resolveGoogleMapsBundle(googleWindow).catch((error: unknown) => {
      googleMapsPromise = null;
      throw error;
    });
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    const timeout = window.setTimeout(() => reject(new Error("Google Maps took too long to load.")), 12_000);
    googleWindow[GOOGLE_MAPS_CALLBACK] = () => {
      window.clearTimeout(timeout);
      resolve();
    };

    if (existingScript) {
      existingScript.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("Google Maps could not be loaded."));
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${GOOGLE_MAPS_CALLBACK}`;
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Google Maps could not be loaded."));
    }, { once: true });
    document.head.append(script);
  }).then(() => resolveGoogleMapsBundle(googleWindow)).catch((error: unknown) => {
    googleMapsPromise = null;
    document.getElementById(GOOGLE_MAPS_SCRIPT_ID)?.remove();
    throw error;
  });

  return googleMapsPromise;
}

export interface GeoGuessMapMarker extends LngLatPoint {
  readonly label: string;
  readonly color?: string;
}

export interface GeoGuessMapOptions {
  readonly signal: AbortSignal;
  readonly onGuessChange: (point: LngLatPoint) => void;
}

export interface GeoGuessMap {
  readonly element: HTMLElement;
  readonly reset: () => void;
  readonly reveal: (target: LngLatPoint, guesses: readonly GeoGuessMapMarker[]) => void;
  readonly setAcceptingGuesses: (accepting: boolean) => void;
  readonly resize: () => void;
  readonly destroy: () => void;
}

function markerElement(className: string, label: string, color?: string): HTMLElement {
  const marker = document.createElement("div");
  marker.className = className;
  marker.setAttribute("aria-label", label);
  marker.setAttribute("role", "img");
  if (color) marker.style.setProperty("--geoguessr-marker-color", color);
  return marker;
}

export function createGeoGuessMap(options: GeoGuessMapOptions): GeoGuessMap {
  const apiKey = googleMapsJavaScriptApiKey();
  let acceptingGuesses = true;
  let destroyed = false;
  let map: GoogleMapInstance | null = null;
  let maps: GoogleMapsNamespace | null = null;
  let AdvancedMarkerElement: GoogleMarkerLibrary["AdvancedMarkerElement"] | null = null;
  let clickListener: GoogleMapsListener | null = null;
  let selectedMarker: GoogleAdvancedMarker | null = null;
  let resultMarkers: GoogleAdvancedMarker[] = [];
  let resultLines: GooglePolyline[] = [];
  let pendingReveal: { readonly target: LngLatPoint; readonly guesses: readonly GeoGuessMapMarker[] } | null = null;
  let observer: ResizeObserver | null = null;
  let loading = false;

  const canvas = document.createElement("div");
  canvas.className = "geoguessr-google-map-canvas";
  const status = document.createElement("div");
  status.className = "geoguessr-google-map-status";
  status.setAttribute("role", "status");
  status.textContent = apiKey ? "Loading Google Maps..." : "The guess map is unavailable.";
  const element = document.createElement("div");
  element.className = "geoguessr-map";
  element.setAttribute("aria-label", "Google world map for placing your location guess");
  element.append(canvas, status);

  function clearMarkersAndLines(): void {
    if (selectedMarker) selectedMarker.map = null;
    selectedMarker = null;
    for (const marker of resultMarkers) marker.map = null;
    for (const line of resultLines) line.setMap(null);
    resultMarkers = [];
    resultLines = [];
  }

  function addMarker(point: LngLatPoint, className: string, label: string, color?: string): GoogleAdvancedMarker | null {
    if (!map || !AdvancedMarkerElement) return null;
    return new AdvancedMarkerElement({ map, position: point, title: label, content: markerElement(className, label, color) });
  }

  function applyReveal(target: LngLatPoint, guesses: readonly GeoGuessMapMarker[]): void {
    if (!map || !maps) return;
    clearMarkersAndLines();
    const targetMarker = addMarker(target, "geoguessr-marker geoguessr-marker-target", "Actual location");
    if (targetMarker) resultMarkers.push(targetMarker);
    const bounds = new maps.LatLngBounds();
    bounds.extend(target);

    for (const guess of guesses) {
      const marker = addMarker(guess, "geoguessr-marker geoguessr-marker-player", guess.label, guess.color);
      if (marker) resultMarkers.push(marker);
      bounds.extend(guess);
      resultLines.push(new maps.Polyline({
        map,
        path: [guess, target],
        geodesic: true,
        strokeColor: guess.color ?? "#d8ec99",
        strokeOpacity: 0.88,
        strokeWeight: 3,
      }));
    }

    if (guesses.length === 0) {
      map.setCenter(target);
      map.setZoom(5);
      return;
    }

    const hasVisibleDistance = guesses.some((guess) =>
      Math.abs(guess.lat - target.lat) > 0.0001 || Math.abs(guess.lng - target.lng) > 0.0001,
    );
    if (!hasVisibleDistance) {
      map.setCenter(target);
      map.setZoom(12);
      return;
    }

    map.fitBounds(bounds, 64);
  }

  function loadMap(): void {
    if (!apiKey || loading || map || destroyed) return;
    loading = true;
    status.hidden = false;
    status.classList.remove("is-error");
    status.textContent = "Loading Google Maps…";
    void loadGoogleMaps(apiKey).then((bundle) => {
      if (destroyed) return;
      maps = bundle.maps;
      AdvancedMarkerElement = bundle.AdvancedMarkerElement;
      map = new maps.Map(canvas, {
        center: { lat: 20, lng: 10 },
        zoom: 2,
        minZoom: 2,
        maxZoom: 18,
        mapId: GOOGLE_DEMO_MAP_ID,
        colorScheme: "DARK",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        backgroundColor: "#172323",
      });
      clickListener = map.addListener("click", (event) => {
        if (!acceptingGuesses || destroyed || !event.latLng) return;
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        if (selectedMarker) selectedMarker.map = null;
        selectedMarker = addMarker(point, "geoguessr-marker geoguessr-marker-guess", "Your guess");
        options.onGuessChange(point);
      });
      status.hidden = true;
      if (pendingReveal) applyReveal(pendingReveal.target, pendingReveal.guesses);
    }).catch(() => {
      if (destroyed) return;
      status.classList.add("is-error");
      status.textContent = "The map couldn’t load. ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "geo-button geoguessr-map-retry";
      retry.textContent = "Retry map";
      retry.addEventListener("click", loadMap, { signal: options.signal });
      status.append(retry);
    }).finally(() => { loading = false; });
  }
  if (apiKey) loadMap();
  else {
    status.classList.add("is-error");
    status.textContent = "The guess map is unavailable right now. Please try again later.";
  }

  function removeMap(): void {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    clickListener?.remove();
    clickListener = null;
    clearMarkersAndLines();
    canvas.replaceChildren();
  }

  options.signal.addEventListener("abort", removeMap);
  observer = new ResizeObserver(() => { if (map && maps) maps.event.trigger(map, "resize"); });
  observer.observe(element);

  return {
    element,
    reset: () => {
      loadMap();
      acceptingGuesses = true;
      pendingReveal = null;
      clearMarkersAndLines();
      map?.setCenter({ lat: 20, lng: 10 });
      map?.setZoom(2);
    },
    reveal: (target, guesses) => {
      acceptingGuesses = false;
      pendingReveal = { target, guesses };
      applyReveal(target, guesses);
    },
    setAcceptingGuesses: (accepting) => { acceptingGuesses = accepting; },
    resize: () => {
      if (map && maps) maps.event.trigger(map, "resize");
    },
    destroy: removeMap,
  };
}
