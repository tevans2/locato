import type { CountryId, CountryIndex } from "../../core/countries";
import {
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  projectWorldMapPosition,
  type ProjectedPoint,
  type WorldCountryFeature,
  type WorldMapPolygon,
  type WorldMapPosition,
} from "../../core/map";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_WIDTH = MAP_VIEWBOX_WIDTH;
const VIEWBOX_HEIGHT = MAP_VIEWBOX_HEIGHT;
const INITIAL_VIEWBOX_Y = 0;
const VIEWBOX_VERTICAL_MARGIN = 20;
const DEFAULT_VIEWBOX: ViewBoxState = { x: 0, y: INITIAL_VIEWBOX_Y, width: VIEWBOX_WIDTH, height: VIEWBOX_HEIGHT };
const MAX_ZOOM = 24;
const ZOOM_IN_FACTOR = 0.78;
const ZOOM_OUT_FACTOR = 1.22;
const MISSING_DOT_BASE_RADIUS = 2;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_DELTA_LINE_PIXELS = 40;
const WHEEL_DELTA_PAGE_PIXELS = 800;
const MAX_WHEEL_DELTA_PIXELS = 140;
const MIN_WHEEL_DELTA_PIXELS = 0.35;

interface ViewBoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly viewBox: ViewBoxState;
  readonly countryId: CountryId | null;
  hasMoved: boolean;
}

export interface WorldMapViewOptions {
  readonly onCountryClick?: (countryId: CountryId) => void;
}

export interface WorldMapView {
  readonly element: HTMLElement;
  readonly highlightedCount: HTMLElement;
  readonly remainingCount: HTMLElement;
  readonly pathByCountryId: ReadonlyMap<CountryId, SVGPathElement>;
  readonly missingDotByCountryId: ReadonlyMap<CountryId, SVGCircleElement>;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function formatPoint(point: WorldMapPosition): string {
  const [x, y] = projectWorldMapPosition(point);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

function polygonToPath(polygon: WorldMapPolygon): string {
  return polygon
    .map((ring) => ring.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPoint(point)}`).join(" ") + " Z")
    .join(" ");
}

function geometryToPath(feature: WorldCountryFeature): string {
  if (feature.geometry.type === "Polygon") return polygonToPath(feature.geometry.coordinates);
  return feature.geometry.coordinates.map(polygonToPath).join(" ");
}

function ringArea(points: readonly ProjectedPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(points: readonly ProjectedPoint[]): ProjectedPoint | null {
  let twiceArea = 0;
  let xTotal = 0;
  let yTotal = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xTotal += (x1 + x2) * cross;
    yTotal += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 0.0001) return null;
  return [xTotal / (3 * twiceArea), yTotal / (3 * twiceArea)];
}

function centerOfBounds(points: readonly ProjectedPoint[]): ProjectedPoint {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function polygonArea(polygon: WorldMapPolygon): number {
  const outerRing = polygon[0];
  if (!outerRing) return 0;
  return Math.abs(ringArea(outerRing.map(projectWorldMapPosition)));
}

function countryCenter(feature: WorldCountryFeature): ProjectedPoint | null {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let largestPolygon: WorldMapPolygon | null = null;
  let largestArea = -1;

  for (const polygon of polygons) {
    const area = polygonArea(polygon);
    if (area > largestArea) {
      largestPolygon = polygon;
      largestArea = area;
    }
  }

  const outerRing = largestPolygon?.[0];
  if (!outerRing || outerRing.length === 0) return null;

  const points = outerRing.map(projectWorldMapPosition);
  return ringCentroid(points) ?? centerOfBounds(points);
}

function createButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "world-map-control-button";
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function applyViewBox(svg: SVGSVGElement, viewBox: ViewBoxState): void {
  svg.setAttribute("viewBox", `${viewBox.x.toFixed(3)} ${viewBox.y.toFixed(3)} ${viewBox.width.toFixed(3)} ${viewBox.height.toFixed(3)}`);
}

function setMissingDotRadius(markers: Iterable<SVGCircleElement>, viewBox: ViewBoxState): void {
  const radius = MISSING_DOT_BASE_RADIUS * (viewBox.width / VIEWBOX_WIDTH);
  for (const marker of markers) marker.setAttribute("r", radius.toFixed(3));
}

function clampViewBox(viewBox: ViewBoxState): ViewBoxState {
  const minWidth = VIEWBOX_WIDTH / MAX_ZOOM;
  const width = Math.min(VIEWBOX_WIDTH, Math.max(minWidth, viewBox.width));
  const height = width * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH);
  const maxX = VIEWBOX_WIDTH - width;
  const minY = -VIEWBOX_VERTICAL_MARGIN;
  const maxY = VIEWBOX_HEIGHT - height + VIEWBOX_VERTICAL_MARGIN;

  return {
    x: Math.min(maxX, Math.max(0, viewBox.x)),
    y: Math.min(maxY, Math.max(minY, viewBox.y)),
    width,
    height,
  };
}

function pointerToMapPosition(svg: SVGSVGElement, viewBox: ViewBoxState, clientX: number, clientY: number): ProjectedPoint {
  const rect = svg.getBoundingClientRect();
  const relativeX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const relativeY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return [viewBox.x + relativeX * viewBox.width, viewBox.y + relativeY * viewBox.height];
}

function zoomAround(svg: SVGSVGElement, viewBox: ViewBoxState, factor: number, clientX: number, clientY: number): ViewBoxState {
  const [mapX, mapY] = pointerToMapPosition(svg, viewBox, clientX, clientY);
  const nextWidth = viewBox.width * factor;
  const nextHeight = viewBox.height * factor;
  const widthRatio = nextWidth / viewBox.width;
  const heightRatio = nextHeight / viewBox.height;

  return clampViewBox({
    x: mapX - (mapX - viewBox.x) * widthRatio,
    y: mapY - (mapY - viewBox.y) * heightRatio,
    width: nextWidth,
    height: nextHeight,
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wheelDeltaYToPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_DELTA_LINE_PIXELS;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * WHEEL_DELTA_PAGE_PIXELS;
  return event.deltaY;
}

function zoomFactorFromWheelDelta(deltaPixels: number): number | null {
  if (Math.abs(deltaPixels) < MIN_WHEEL_DELTA_PIXELS) return null;

  const boundedDelta = clampNumber(deltaPixels, -MAX_WHEEL_DELTA_PIXELS, MAX_WHEEL_DELTA_PIXELS);
  return Math.exp(boundedDelta * WHEEL_ZOOM_SENSITIVITY);
}

function countryIdFromEventTarget(target: EventTarget | null): CountryId | null {
  const element = target instanceof Element ? target : null;
  const countryPath = element?.closest<SVGPathElement>(".world-map-country[data-country-id]");
  const countryId = Number(countryPath?.dataset.countryId);
  return Number.isInteger(countryId) ? countryId : null;
}

export function createWorldMapView(features: readonly WorldCountryFeature[], countryIndex: CountryIndex, options: WorldMapViewOptions = {}): WorldMapView {
  const svg = createSvgElement("svg");
  applyViewBox(svg, DEFAULT_VIEWBOX);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Unlabeled flat world map. Drag to pan and scroll to zoom.");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("class", "world-map-svg");

  const mapLayer = createSvgElement("g");
  const markerLayer = createSvgElement("g");
  markerLayer.setAttribute("class", "world-map-marker-layer");

  const pathByCountryId = new Map<CountryId, SVGPathElement>();
  const missingDotByCountryId = new Map<CountryId, SVGCircleElement>();
  let viewBox: ViewBoxState = { ...DEFAULT_VIEWBOX };
  let panState: PanState | null = null;
  let suppressNextCountryClick = false;
  let pendingWheelDelta = 0;
  let pendingWheelClientX = 0;
  let pendingWheelClientY = 0;
  let wheelAnimationFrame: number | null = null;

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    const path = createSvgElement("path");
    path.setAttribute("d", geometryToPath(feature));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.classList.add("world-map-country");

    if (country) {
      const center = countryCenter(feature);
      path.dataset.countryId = String(country.id);
      pathByCountryId.set(country.id, path);

      if (center) {
        const dot = createSvgElement("circle");
        dot.classList.add("world-map-missing-dot");
        dot.dataset.countryId = String(country.id);
        dot.setAttribute("cx", center[0].toFixed(3));
        dot.setAttribute("cy", center[1].toFixed(3));
        dot.setAttribute("r", MISSING_DOT_BASE_RADIUS.toFixed(3));
        dot.setAttribute("aria-hidden", "true");
        missingDotByCountryId.set(country.id, dot);
        markerLayer.append(dot);
      }
    } else {
      path.classList.add("world-map-country-unplayable");
    }

    mapLayer.append(path);
  }

  svg.append(mapLayer, markerLayer);

  const highlightedCount = document.createElement("strong");
  highlightedCount.textContent = "0";
  const remainingCount = document.createElement("strong");
  remainingCount.textContent = String(countryIndex.countries.length);

  const zoomInButton = createButton("+", "Zoom in");
  const zoomOutButton = createButton("−", "Zoom out");
  const resetViewButton = createButton("Reset", "Reset map zoom and position");
  const controls = document.createElement("div");
  controls.className = "world-map-controls";
  controls.append(zoomInButton, zoomOutButton, resetViewButton);

  function setViewBox(nextViewBox: ViewBoxState): void {
    viewBox = clampViewBox(nextViewBox);
    applyViewBox(svg, viewBox);
    setMissingDotRadius(missingDotByCountryId.values(), viewBox);
  }

  function resetViewBox(): void {
    setViewBox(DEFAULT_VIEWBOX);
  }

  function applyPendingWheelZoom(): void {
    wheelAnimationFrame = null;
    const deltaPixels = pendingWheelDelta;
    pendingWheelDelta = 0;

    const factor = zoomFactorFromWheelDelta(deltaPixels);
    if (factor === null) return;

    setViewBox(zoomAround(svg, viewBox, factor, pendingWheelClientX, pendingWheelClientY));
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    pendingWheelDelta += wheelDeltaYToPixels(event);
    pendingWheelClientX = event.clientX;
    pendingWheelClientY = event.clientY;

    if (wheelAnimationFrame === null) {
      wheelAnimationFrame = window.requestAnimationFrame(applyPendingWheelZoom);
    }
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    panState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox: { ...viewBox },
      countryId: countryIdFromEventTarget(event.target),
      hasMoved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!panState || panState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const rawDeltaX = event.clientX - panState.clientX;
    const rawDeltaY = event.clientY - panState.clientY;
    if (rawDeltaX * rawDeltaX + rawDeltaY * rawDeltaY > 16) panState.hasMoved = true;
    const deltaX = rect.width > 0 ? (rawDeltaX / rect.width) * panState.viewBox.width : 0;
    const deltaY = rect.height > 0 ? (rawDeltaY / rect.height) * panState.viewBox.height : 0;
    setViewBox({ ...panState.viewBox, x: panState.viewBox.x - deltaX, y: panState.viewBox.y - deltaY });
  });

  function finishPan(event: PointerEvent): void {
    if (!panState || panState.pointerId !== event.pointerId) return;

    const clickedCountryId = !panState.hasMoved ? panState.countryId : null;
    suppressNextCountryClick = true;
    panState = null;
    svg.classList.remove("is-panning");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);

    if (clickedCountryId !== null) options.onCountryClick?.(clickedCountryId);
  }

  svg.addEventListener("pointerup", finishPan);
  svg.addEventListener("pointercancel", finishPan);
  svg.addEventListener("click", (event) => {
    if (suppressNextCountryClick) {
      suppressNextCountryClick = false;
      return;
    }

    const countryId = countryIdFromEventTarget(event.target);
    if (countryId === null) return;
    options.onCountryClick?.(countryId);
  });
  svg.addEventListener("dragstart", (event) => event.preventDefault());
  svg.addEventListener("dblclick", resetViewBox);
  zoomInButton.addEventListener("click", () => setViewBox(zoomAround(svg, viewBox, ZOOM_IN_FACTOR, svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2)));
  zoomOutButton.addEventListener("click", () => setViewBox(zoomAround(svg, viewBox, ZOOM_OUT_FACTOR, svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2)));
  resetViewButton.addEventListener("click", resetViewBox);

  const element = document.createElement("div");
  element.className = "world-map-panel";
  element.append(
    svg,
    controls,
    document.createElement("div"),
  );
  const meta = element.lastElementChild as HTMLElement;
  meta.className = "world-map-meta";
  meta.append(
    document.createElement("span"),
    document.createElement("span"),
  );
  meta.children[0]!.append("Found ", highlightedCount);
  meta.children[1]!.append("Left ", remainingCount);

  return { element, highlightedCount, remainingCount, pathByCountryId, missingDotByCountryId };
}

export function setWorldMapMissingMarkersVisible(view: WorldMapView, visible: boolean): void {
  view.element.classList.toggle("show-missing-countries", visible);
}

export function updateWorldMapView(view: WorldMapView, guessedCountryIds: ReadonlySet<CountryId>, totalCountries: number): void {
  for (const [countryId, path] of view.pathByCountryId.entries()) {
    const guessed = guessedCountryIds.has(countryId);
    path.classList.toggle("is-guessed", guessed);
    view.missingDotByCountryId.get(countryId)?.classList.toggle("is-guessed", guessed);
  }

  view.highlightedCount.textContent = String(guessedCountryIds.size);
  view.remainingCount.textContent = String(Math.max(0, totalCountries - guessedCountryIds.size));
}
