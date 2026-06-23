import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapTapGuessResult } from "../../core/maptap";

const RESULT_LINE_SOURCE_ID = "maptap-result-line";
const RESULT_LINE_LAYER_ID = "maptap-result-line-layer";
const EMPTY_LINE_DATA: Parameters<maplibregl.GeoJSONSource["setData"]>[0] = {
  type: "FeatureCollection",
  features: [],
};

export interface MapTapClick {
  readonly lat: number;
  readonly lng: number;
}

export interface MapTapGlobeOptions {
  readonly onGuess: (point: MapTapClick) => void;
  readonly signal: AbortSignal;
}

export interface MapTapMultiplayerGuess {
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  readonly color: string;
}

export interface MapTapGlobe {
  readonly element: HTMLElement;
  readonly reset: () => void;
  readonly reveal: (result: MapTapGuessResult) => void;
  readonly revealMultiplayer: (target: { lat: number; lng: number }, guesses: readonly MapTapMultiplayerGuess[]) => void;
  readonly setAcceptingGuesses: (accepting: boolean) => void;
  readonly destroy: () => void;
}

function createMarkerElement(className: string, label: string): HTMLElement {
  const marker = document.createElement("div");
  marker.className = className;
  marker.setAttribute("aria-label", label);
  marker.setAttribute("role", "img");
  return marker;
}

function resultLineData(result: MapTapGuessResult): Parameters<maplibregl.GeoJSONSource["setData"]>[0] {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [result.guess.lng, result.guess.lat],
            [result.target.lng, result.target.lat],
          ],
        },
      },
    ],
  };
}

export function createMapTapGlobe(options: MapTapGlobeOptions): MapTapGlobe {
  let acceptingGuesses = true;
  let guessMarker: maplibregl.Marker | null = null;
  let targetMarker: maplibregl.Marker | null = null;
  let extraMarkers: maplibregl.Marker[] = [];
  let destroyed = false;

  const element = document.createElement("div");
  element.className = "maptap-globe";

  const attribution = document.createElement("div");
  attribution.className = "maptap-attribution";
  attribution.textContent = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

  const map = new maplibregl.Map({
    container: element,
    center: [12, 20],
    zoom: 1.2,
    minZoom: 0.4,
    maxZoom: 16,
    attributionControl: false,
    canvasContextAttributes: { alpha: true, antialias: true },
    style: {
      version: 8,
      // MapLibre GL JS v5 configures globe projection in the style object.
      // This is the v5 equivalent of the older map option `projection: "globe"`.
      projection: { type: "globe" },
      sources: {
        "esri-world-imagery": {
          type: "raster",
          tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: "maptap-space-background",
          type: "background",
          paint: { "background-color": "rgba(0, 0, 0, 0)" },
        },
        {
          id: "esri-world-imagery-layer",
          type: "raster",
          source: "esri-world-imagery",
        },
      ],
    },
  });

  element.append(attribution);

  function ensureLineLayer(): void {
    if (map.getSource(RESULT_LINE_SOURCE_ID) === undefined) {
      map.addSource(RESULT_LINE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_LINE_DATA,
      });
    }
    if (map.getLayer(RESULT_LINE_LAYER_ID) === undefined) {
      map.addLayer({
        id: RESULT_LINE_LAYER_ID,
        type: "line",
        source: RESULT_LINE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 3, "line-color": "#ffffff", "line-opacity": 0.9 },
      });
    }
  }

  function setLineData(data: Parameters<maplibregl.GeoJSONSource["setData"]>[0]): void {
    ensureLineLayer();
    const source = map.getSource(RESULT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }

  function clearMarkers(): void {
    guessMarker?.remove();
    targetMarker?.remove();
    guessMarker = null;
    targetMarker = null;
    for (const m of extraMarkers) m.remove();
    extraMarkers = [];
  }

  map.on("load", () => {
    ensureLineLayer();
  });

  map.on("click", (event) => {
    if (!acceptingGuesses || destroyed) return;
    options.onGuess({ lng: event.lngLat.lng, lat: event.lngLat.lat });
  });

  function removeMap(): void {
    if (destroyed) return;
    destroyed = true;
    map.remove();
  }

  options.signal.addEventListener("abort", removeMap);

  const resizeMap = () => map.resize();
  window.addEventListener("resize", resizeMap, { signal: options.signal });
  requestAnimationFrame(resizeMap);

  return {
    element,
    reset: () => {
      acceptingGuesses = true;
      clearMarkers();
      if (map.loaded()) setLineData(EMPTY_LINE_DATA);
    },
    reveal: (result) => {
      acceptingGuesses = false;
      clearMarkers();
      guessMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-guess", "Your guess"), anchor: "center" })
        .setLngLat([result.guess.lng, result.guess.lat])
        .addTo(map);
      targetMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-target", "Actual location"), anchor: "center" })
        .setLngLat([result.target.lng, result.target.lat])
        .addTo(map);
      setLineData(resultLineData(result));
      const bounds = new maplibregl.LngLatBounds([result.guess.lng, result.guess.lat], [result.guess.lng, result.guess.lat]).extend([result.target.lng, result.target.lat]);
      map.fitBounds(bounds, { padding: 90, duration: 800, maxZoom: 7 });
    },
    revealMultiplayer: (target, guesses) => {
      acceptingGuesses = false;
      clearMarkers();
      targetMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-target", "Actual location"), anchor: "center" })
        .setLngLat([target.lng, target.lat])
        .addTo(map);
      const bounds = new maplibregl.LngLatBounds([target.lng, target.lat], [target.lng, target.lat]);
      const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (const guess of guesses) {
        const markerEl = createMarkerElement("maptap-marker", guess.label);
        markerEl.style.background = guess.color;
        const marker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([guess.lng, guess.lat])
          .addTo(map);
        extraMarkers.push(marker);
        bounds.extend([guess.lng, guess.lat]);
        lineFeatures.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[guess.lng, guess.lat], [target.lng, target.lat]] } });
      }
      ensureLineLayer();
      const source = map.getSource(RESULT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: lineFeatures });
      map.fitBounds(bounds, { padding: 90, duration: 800, maxZoom: 7 });
    },
    setAcceptingGuesses: (accepting) => {
      acceptingGuesses = accepting;
    },
    destroy: removeMap,
  };
}
