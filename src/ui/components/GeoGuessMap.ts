import type { LngLatPoint } from "../../core/maptap/distance";
import { loadWorldCountryFeatures } from "../../core/map/worldMapData";
import type { WorldCountryFeature } from "../../core/map/types";
import { mainLandmassBounds } from "../../core/map/mainLandmass";
import { MAP_VIEWBOX_WIDTH, MAP_VIEWBOX_HEIGHT, MAP_MIN_LONGITUDE, MAP_MAX_LONGITUDE, MAP_MIN_LATITUDE, MAP_MAX_LATITUDE } from "../../core/map/projection";

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
  fitBounds(bounds: GoogleLatLngBounds, padding?: number | GeoMapPadding): void;
  setCenter(center: LngLatPoint): void;
  setZoom(zoom: number): void;
  getZoom(): number | undefined;
  setMapTypeId(type: string): void;
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
  readonly Polygon: new (options: Record<string, unknown>) => GooglePolyline;
  readonly event: { trigger(instance: object, eventName: "resize"): void };
  readonly importLibrary: (libraryName: "maps" | "marker" | "streetView") => Promise<unknown>;
}

interface GoogleMarkerLibrary {
  readonly AdvancedMarkerElement: new (options: { readonly map: GoogleMapInstance; readonly position: LngLatPoint; readonly title: string; readonly content: HTMLElement; readonly zIndex: number }) => GoogleAdvancedMarker;
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
  const [, markerLibrary] = await Promise.all([maps.importLibrary("maps"), maps.importLibrary("marker")]) as [unknown, GoogleMarkerLibrary];
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
  /** The solo screen supplies its own controls; other consumers keep native zoom buttons. */
  readonly nativeControls?: boolean;
  readonly revealPadding?: () => GeoMapPadding;
}

export interface GeoMapPadding { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number; }

export type GeoMapStyle = "roadmap" | "terrain" | "hybrid";

export interface GeoGuessMap {
  readonly element: HTMLElement;
  readonly reset: () => void;
  readonly reveal: (target: LngLatPoint, guesses: readonly GeoGuessMapMarker[]) => void;
  readonly setAcceptingGuesses: (accepting: boolean) => void;
  readonly resize: () => void;
  readonly destroy: () => void;
  readonly setStyle?: (style: GeoMapStyle) => void;
  readonly zoomBy?: (delta: number) => void;
  readonly showWorld?: () => void;
  readonly showGuess?: () => void;
  readonly highlightCountry?: (code: string) => void;
  readonly showCountry?: () => void;
  readonly showResult?: () => void;
}

function markerElement(className: string, label: string, color?: string): HTMLElement {
  const marker = document.createElement("div");
  const target = className.includes("marker-target");
  marker.className = className;
  marker.setAttribute("aria-label", label);
  marker.setAttribute("role", "img");
  marker.style.setProperty("--geoguessr-marker-color", color ?? (target ? "#d6a047" : "#287965"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 44 58");
  svg.setAttribute("aria-hidden", "true");
  const shape = (tag: "path" | "circle", attrs: Record<string, string>) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  };
  shape("path", { d: "M22 2C10.95 2 2 10.8 2 21.5C2 36 22 56 22 56S42 36 42 21.5C42 10.8 33.05 2 22 2Z", fill: "var(--geoguessr-marker-color)", stroke: "#fff", "stroke-width": "3", "stroke-linejoin": "round" });
  shape("path", { d: "M8 19A14 14 0 0 1 27 8", fill: "none", stroke: "#fff", "stroke-opacity": ".38", "stroke-width": "2", "stroke-linecap": "round" });
  shape("circle", { cx: "22", cy: "22", r: "12.5", fill: target ? "#593b13" : "#173f36", stroke: "#fff", "stroke-opacity": ".85", "stroke-width": "1" });
  if (target) {
    shape("path", { d: "M18 30V15M19 16H29L26 20L29 24H19", fill: "#ffe19b", stroke: "#ffe19b", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" });
  } else {
    // Locato's compass needle: an original mark that stays legible at map scale.
    shape("path", { d: "M27.5 14.5L24.5 24.5L16.5 29.5L19.5 19.5Z", fill: "#fff", "stroke-linejoin": "round" });
    shape("path", { d: "M22 22L24.5 24.5L16.5 29.5Z", fill: "#96cdb7" });
    shape("circle", { cx: "22", cy: "22", r: "1.7", fill: "#173f36" });
  }
  marker.append(svg);
  if (!className.includes("marker-guess")) {
    const tag = document.createElement("span");
    tag.className = "geoguessr-marker-label";
    tag.textContent = target ? "Actual location" : label;
    tag.setAttribute("aria-hidden", "true");
    marker.append(tag);
  }
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
  let style: GeoMapStyle = "roadmap";
  let selectedPoint: LngLatPoint | null = null;
  let country: WorldCountryFeature | null = null;
  let countryPolygons: GooglePolyline[] = [];
  let countryRequest = 0;
  let countryViewRequested = false;
  let resizeFrame = 0;
  let lastWidth = -1;
  let lastHeight = -1;

  function clearCountry(): void {
    countryRequest += 1;
    country = null;
    countryViewRequested = false;
    for (const polygon of countryPolygons) polygon.setMap(null);
    countryPolygons = [];
  }
  function drawCountry(): void {
    if (!country || !map || !maps) return;
    for (const polygon of countryPolygons) polygon.setMap(null);
    const polygons = country.geometry.type === "Polygon" ? [country.geometry.coordinates] : country.geometry.coordinates;
    countryPolygons = polygons.map(polygon => new maps!.Polygon({
      map, paths: polygon.map(ring => ring.map(([lng, lat]) => ({ lat, lng }))),
      fillColor: "#e78651", fillOpacity: 0.16, strokeColor: "#c75a2a", strokeOpacity: 0.85, strokeWeight: 2,
      clickable: false,
    }));
  }
  function showWorld(): void {
    countryViewRequested = false;
    map?.setCenter({ lat: 20, lng: 10 });
    map?.setZoom(worldZoom());
  }
  // A world at zoom 2 is 1,024px wide; fit it even in a compact phone map.
  function worldZoom(): number { return Math.max(0, Math.min(2, Math.floor(Math.log2((element.clientWidth || 1024) / 256)))); }
  function showCountry(): void {
    if (!map || !maps || !pendingReveal) return;
    countryViewRequested = true;
    const target = pendingReveal.target;
    const rect = country ? mainLandmassBounds(country, { anchor: [target.lng, target.lat] }) : null;
    if (!rect) { map.setCenter(target); map.setZoom(5); return; }
    const bounds = new maps.LatLngBounds();
    const longitude = (x: number) => MAP_MIN_LONGITUDE + x / MAP_VIEWBOX_WIDTH * (MAP_MAX_LONGITUDE - MAP_MIN_LONGITUDE);
    const latitude = (y: number) => MAP_MAX_LATITUDE - y / MAP_VIEWBOX_HEIGHT * (MAP_MAX_LATITUDE - MAP_MIN_LATITUDE);
    bounds.extend({ lat: latitude(rect.y), lng: longitude(rect.x) });
    bounds.extend({ lat: latitude(rect.y + rect.height), lng: longitude(rect.x + rect.width) });
    bounds.extend(target);
    map.fitBounds(bounds, options.revealPadding?.() ?? 48);
  }

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
    return new AdvancedMarkerElement({ map, position: point, title: label, content: markerElement(className, label, color), zIndex: className.includes("marker-target") ? 1100 : 1000 });
  }

  function applyReveal(target: LngLatPoint, guesses: readonly GeoGuessMapMarker[]): void {
    if (!map || !maps) return;
    clearMarkersAndLines();
    const targetMarker = addMarker(target, "geoguessr-marker geoguessr-marker-target", "Actual location");
    if (targetMarker) resultMarkers.push(targetMarker);
    for (const guess of guesses) {
      const marker = addMarker(guess, "geoguessr-marker geoguessr-marker-player", guess.label, guess.color);
      if (marker) resultMarkers.push(marker);
      // A white casing keeps the charcoal dashes readable on every map layer.
      // Both overlays share a geodesic path and stay below the labelled pins.
      const path = [guess, target];
      resultLines.push(
        new maps.Polyline({ map, path, geodesic: true, clickable: false, strokeColor: "#ffffff", strokeOpacity: 0.96, strokeWeight: 7, zIndex: 30 }),
        new maps.Polyline({
          map, path, geodesic: true, clickable: false, strokeOpacity: 0, zIndex: 31,
          icons: [{ icon: { path: "M 0,-1.5 0,1.5", strokeColor: "#263e34", strokeOpacity: 1, strokeWeight: 4, scale: 3 }, offset: "0", repeat: "18px" }],
        }),
      );
    }

    frameResult();
  }

  // Camera changes must not destroy and recreate the result overlays.
  function frameResult(): void {
    if (!map || !maps || !pendingReveal) return;
    const { target, guesses } = pendingReveal;
    const bounds = new maps.LatLngBounds();
    bounds.extend(target);
    for (const guess of guesses) bounds.extend(guess);
    const hasVisibleDistance = guesses.some((guess) =>
      Math.abs(guess.lat - target.lat) > 0.0001 || Math.abs(guess.lng - target.lng) > 0.0001,
    );
    if (!hasVisibleDistance) {
      bounds.extend({ lat: Math.min(85, target.lat + 0.025), lng: target.lng + 0.025 });
      bounds.extend({ lat: Math.max(-85, target.lat - 0.025), lng: target.lng - 0.025 });
    }
    map.fitBounds(bounds, options.revealPadding?.() ?? 64);
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
        zoom: worldZoom(),
        minZoom: 0,
        maxZoom: 18,
        mapId: GOOGLE_DEMO_MAP_ID,
        colorScheme: "LIGHT",
        renderingType: "VECTOR",
        isFractionalZoomEnabled: true,
        tilt: 0,
        tiltInteractionEnabled: false,
        headingInteractionEnabled: false,
        mapTypeId: style,
        disableDefaultUI: true,
        zoomControl: options.nativeControls !== false,
        keyboardShortcuts: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        draggableCursor: "crosshair",
        draggingCursor: "crosshair",
        gestureHandling: "greedy",
        backgroundColor: "#dcebed",
      });
      clickListener = map.addListener("click", (event) => {
        if (!acceptingGuesses || destroyed || !event.latLng) return;
        const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        selectedPoint = point;
        if (selectedMarker) selectedMarker.map = null;
        selectedMarker = addMarker(point, "geoguessr-marker geoguessr-marker-guess", "Your guess");
        options.onGuessChange(point);
      });
      status.hidden = true;
      if (pendingReveal) applyReveal(pendingReveal.target, pendingReveal.guesses);
      drawCountry();
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
    cancelAnimationFrame(resizeFrame);
    clickListener?.remove();
    clickListener = null;
    clearMarkersAndLines();
    clearCountry();
    canvas.replaceChildren();
  }

  options.signal.addEventListener("abort", removeMap);
  function resizeMap(): void {
    if (destroyed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (destroyed || !map || !maps) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      maps.event.trigger(map, "resize");
      if (pendingReveal) {
        if (countryViewRequested) showCountry();
        else frameResult();
      }
    });
  }
  observer = new ResizeObserver(resizeMap);
  observer.observe(element);

  return {
    element,
    reset: () => {
      loadMap();
      acceptingGuesses = true;
      pendingReveal = null;
      selectedPoint = null;
      clearCountry();
      clearMarkersAndLines();
      showWorld();
    },
    reveal: (target, guesses) => {
      acceptingGuesses = false;
      pendingReveal = { target, guesses };
      applyReveal(target, guesses);
    },
    setAcceptingGuesses: (accepting) => { acceptingGuesses = accepting; },
    resize: resizeMap,
    destroy: removeMap,
    setStyle: (next) => { if (style === next) return; style = next; map?.setMapTypeId(next); },
    zoomBy: (delta) => { if (map) map.setZoom(Math.max(0, Math.min(18, (map.getZoom() ?? 2) + delta))); },
    showWorld,
    showGuess: () => { if (selectedPoint && map) { map.setCenter(selectedPoint); map.setZoom(Math.max(5, map.getZoom() ?? 2)); } },
    highlightCountry: (code) => {
      clearCountry();
      const id = countryRequest;
      if (!code || !pendingReveal) return;
      void loadWorldCountryFeatures().then(features => {
        if (destroyed || id !== countryRequest || !pendingReveal) return;
        country = features.find(feature => feature.code.toUpperCase() === code.toUpperCase()) ?? null;
        drawCountry();
        if (countryViewRequested) showCountry();
      }).catch(() => { /* Pins and scoring remain usable if the outline cannot load. */ });
    },
    showCountry,
    showResult: () => { countryViewRequested = false; frameResult(); },
  };
}
