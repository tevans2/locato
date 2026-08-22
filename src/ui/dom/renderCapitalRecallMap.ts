import type { Country, CountryId, CountryIndex } from "../../core/countries";
import {
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  projectWorldMapPosition,
  type ProjectedPoint,
  type WorldCountryFeature,
  type WorldMapPolygon,
  type WorldMapPosition,
} from "../../core/map";
import { el } from "./createElement";

const SVG_NS = "http://www.w3.org/2000/svg";
const RECENT_LABEL_COUNT = 8;
const RECENT_LIST_COUNT = 5;
const DEFAULT_VIEWBOX: ViewBoxState = { x: 0, y: 0, width: MAP_VIEWBOX_WIDTH, height: MAP_VIEWBOX_HEIGHT };
const MAX_ZOOM = 14;
const VIEWBOX_VERTICAL_MARGIN = 20;
const ZOOM_IN_FACTOR = 0.78;
const ZOOM_OUT_FACTOR = 1.22;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_DELTA_LINE_PIXELS = 40;
const WHEEL_DELTA_PAGE_PIXELS = 800;
const MAX_WHEEL_DELTA_PIXELS = 140;
const MIN_WHEEL_DELTA_PIXELS = 0.35;
const ZOOM_LABEL_THRESHOLD = 2.15;
const VIEWBOX_ANIMATION_MS = 520;

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
}

interface TouchPoint {
  readonly clientX: number;
  readonly clientY: number;
}

interface PinchState {
  readonly viewBox: ViewBoxState;
  readonly distance: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface CapitalRecallMapViewOptions {
  readonly signal?: AbortSignal;
}

/** Copy overrides for the "Capital of <name>" panel — free play reads differently. */
export interface CapitalRecallUpdateLabels {
  readonly prefixLabel?: string;
  readonly emptyLabel?: string;
}

export interface CapitalRecallMapView {
  readonly element: HTMLElement;
  readonly update: (guessedCountryIds: ReadonlySet<CountryId>, currentCountryId: CountryId | null, latestCountryId: CountryId | null, labels?: CapitalRecallUpdateLabels) => void;
}

interface MarkerEntry {
  readonly group: SVGGElement;
  readonly halo: SVGCircleElement;
  readonly dot: SVGCircleElement;
  readonly label: SVGTextElement;
  readonly x: number;
  readonly y: number;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampViewBox(viewBox: ViewBoxState): ViewBoxState {
  const minWidth = MAP_VIEWBOX_WIDTH / MAX_ZOOM;
  const width = clampNumber(viewBox.width, minWidth, MAP_VIEWBOX_WIDTH);
  const height = width * (MAP_VIEWBOX_HEIGHT / MAP_VIEWBOX_WIDTH);
  const maxX = MAP_VIEWBOX_WIDTH - width;
  const minY = -VIEWBOX_VERTICAL_MARGIN;
  const maxY = MAP_VIEWBOX_HEIGHT - height + VIEWBOX_VERTICAL_MARGIN;

  return {
    x: clampNumber(viewBox.x, 0, maxX),
    y: clampNumber(viewBox.y, minY, maxY),
    width,
    height,
  };
}

function applyViewBox(svg: SVGSVGElement, viewBox: ViewBoxState): void {
  svg.setAttribute("viewBox", `${viewBox.x.toFixed(3)} ${viewBox.y.toFixed(3)} ${viewBox.width.toFixed(3)} ${viewBox.height.toFixed(3)}`);
}

function pointerToMapPosition(svg: SVGSVGElement, viewBox: ViewBoxState, clientX: number, clientY: number): ProjectedPoint {
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / viewBox.width || 1, rect.height / viewBox.height || 1);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const relativeX = renderedWidth > 0 ? clampNumber((clientX - rect.left - offsetX) / renderedWidth, 0, 1) : 0.5;
  const relativeY = renderedHeight > 0 ? clampNumber((clientY - rect.top - offsetY) / renderedHeight, 0, 1) : 0.5;
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

function wheelDeltaYToPixels(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_DELTA_LINE_PIXELS;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * WHEEL_DELTA_PAGE_PIXELS;
  return event.deltaY;
}

function zoomFactorFromWheelDelta(deltaPixels: number): number | null {
  if (Math.abs(deltaPixels) < MIN_WHEEL_DELTA_PIXELS) return null;
  return Math.exp(clampNumber(deltaPixels, -MAX_WHEEL_DELTA_PIXELS, MAX_WHEEL_DELTA_PIXELS) * WHEEL_ZOOM_SENSITIVITY);
}

function recentCountries(countryIndex: CountryIndex, guessedCountryIds: ReadonlySet<CountryId>, count: number): readonly Country[] {
  return [...guessedCountryIds]
    .slice(-count)
    .reverse()
    .map((countryId) => countryIndex.byId[countryId])
    .filter((country): country is Country => country !== undefined);
}

export function createCapitalRecallMapView(
  features: readonly WorldCountryFeature[],
  countryIndex: CountryIndex,
  options: CapitalRecallMapViewOptions = {},
): CapitalRecallMapView {
  const playableCapitalTotal = countryIndex.countries.filter((country) => country.capital.length > 0).length;
  const pathByCountryId = new Map<CountryId, SVGPathElement>();
  const markerByCountryId = new Map<CountryId, MarkerEntry>();
  let previousLatestCountryId: CountryId | null = null;
  let viewBox: ViewBoxState = { ...DEFAULT_VIEWBOX };
  let panState: PanState | null = null;
  const touchPointers = new Map<number, TouchPoint>();
  let pinchState: PinchState | null = null;
  let pendingWheelDelta = 0;
  let pendingWheelClientX = 0;
  let wheelAnimationFrame: number | null = null;
  let viewBoxAnimationFrame: number | null = null;
  // Country path under the pointer at press time, kept to distinguish taps from pans.
  let pressTarget: { pointerId: number; clientX: number; clientY: number; countryId: string } | null = null;

  const svg = createSvgElement("svg");
  applyViewBox(svg, DEFAULT_VIEWBOX);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Interactive world map of solved capital cities. Drag to pan and scroll or pinch to zoom.");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("class", "capital-recall-map-svg");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-describedby", "capital-map-instructions");

  const mapLayer = createSvgElement("g");
  const markerLayer = createSvgElement("g");
  markerLayer.setAttribute("class", "capital-recall-marker-layer");

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    const path = createSvgElement("path");
    path.setAttribute("d", geometryToPath(feature));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.classList.add("capital-recall-country");

    if (country) {
      path.dataset.countryId = String(country.id);
      pathByCountryId.set(country.id, path);

      const center = countryCenter(feature);
      if (center && country.capital.length > 0) {
        const [x, y] = center;
        const group = createSvgElement("g");
        group.classList.add("capital-recall-marker");
        group.dataset.countryId = String(country.id);

        const halo = createSvgElement("circle");
        halo.classList.add("capital-recall-marker-halo");
        halo.setAttribute("cx", x.toFixed(3));
        halo.setAttribute("cy", y.toFixed(3));
        halo.setAttribute("r", "8.4");
        halo.setAttribute("vector-effect", "non-scaling-stroke");

        const dot = createSvgElement("circle");
        dot.classList.add("capital-recall-marker-dot");
        dot.setAttribute("cx", x.toFixed(3));
        dot.setAttribute("cy", y.toFixed(3));
        dot.setAttribute("r", "3.4");
        dot.setAttribute("vector-effect", "non-scaling-stroke");

        const label = createSvgElement("text");
        label.classList.add("capital-recall-marker-label");
        label.setAttribute("x", x.toFixed(3));
        label.setAttribute("y", Math.max(14, y - 13).toFixed(3));
        label.setAttribute("text-anchor", "middle");
        label.textContent = country.capital;

        const title = createSvgElement("title");
        title.textContent = `${country.capital}, ${country.name}`;

        group.append(title, halo, dot, label);
        markerByCountryId.set(country.id, { group, halo, dot, label, x, y });
        markerLayer.append(group);
      }
    } else {
      path.classList.add("is-unplayable");
    }

    mapLayer.append(path);
  }

  svg.append(mapLayer, markerLayer);

  const currentPrefix = el("span", { className: "capital-map-current-prefix", text: "Capital of" });
  const currentName = el("strong", { className: "capital-map-current-name" });
  const progress = el("span", { className: "capital-map-progress" });
  const currentPanel = el("div", {
    className: "capital-map-current",
    children: [el("div", { className: "capital-map-current-copy", children: [currentPrefix, currentName] }), progress],
  });
  const recentList = el("div", { className: "capital-map-recent", attrs: { "aria-label": "Recent solved capitals" } });
  const gestureHint = el("span", {
    className: "capital-map-gesture-hint",
    text: "Drag to move · scroll or pinch to zoom",
    attrs: { id: "capital-map-instructions" },
  });
  const element = el("div", { className: "capital-recall-map-panel", children: [svg, currentPanel, gestureHint, recentList] });

  function cancelViewBoxAnimation(): void {
    if (viewBoxAnimationFrame === null) return;
    window.cancelAnimationFrame(viewBoxAnimationFrame);
    viewBoxAnimationFrame = null;
  }

  function markViewportInteraction(): void {
    element.classList.add("has-map-interaction");
  }

  function updateViewportPresentation(): void {
    const zoom = MAP_VIEWBOX_WIDTH / viewBox.width;
    const scale = viewBox.width / MAP_VIEWBOX_WIDTH;
    element.classList.toggle("is-zoomed", zoom > 1.01);
    element.dataset.zoom = zoom.toFixed(2);

    for (const marker of markerByCountryId.values()) {
      marker.halo.setAttribute("r", (8.4 * scale).toFixed(3));
      marker.dot.setAttribute("r", (3.4 * scale).toFixed(3));
      const labelAbove = marker.y - 13 * scale;
      const labelY = labelAbove < viewBox.y + 12 * scale ? marker.y + 18 * scale : labelAbove;
      marker.label.setAttribute("y", labelY.toFixed(3));
      marker.label.style.fontSize = `${(10 * scale).toFixed(3)}px`;
      marker.label.style.strokeWidth = `${(4 * scale).toFixed(3)}px`;
      const isWithinView =
        marker.x >= viewBox.x && marker.x <= viewBox.x + viewBox.width && marker.y >= viewBox.y && marker.y <= viewBox.y + viewBox.height;
      marker.group.classList.toggle("is-zoom-visible", zoom >= ZOOM_LABEL_THRESHOLD && isWithinView);
    }
  }

  function setViewBox(nextViewBox: ViewBoxState): void {
    cancelViewBoxAnimation();
    viewBox = clampViewBox(nextViewBox);
    applyViewBox(svg, viewBox);
    updateViewportPresentation();
  }

  function animateViewBox(nextViewBox: ViewBoxState): void {
    cancelViewBoxAnimation();
    const from = { ...viewBox };
    const to = clampViewBox(nextViewBox);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewBox(to);
      return;
    }

    const startedAt = performance.now();
    function tick(now: number): void {
      const progress = clampNumber((now - startedAt) / VIEWBOX_ANIMATION_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      viewBox = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        width: from.width + (to.width - from.width) * eased,
        height: from.height + (to.height - from.height) * eased,
      };
      applyViewBox(svg, viewBox);
      updateViewportPresentation();
      if (progress < 1) {
        viewBoxAnimationFrame = window.requestAnimationFrame(tick);
      } else {
        viewBoxAnimationFrame = null;
        viewBox = to;
        applyViewBox(svg, viewBox);
        updateViewportPresentation();
      }
    }
    viewBoxAnimationFrame = window.requestAnimationFrame(tick);
  }

  function resetView(animate = true): void {
    if (animate) animateViewBox(DEFAULT_VIEWBOX);
    else setViewBox(DEFAULT_VIEWBOX);
  }

  function applyPendingWheelZoom(): void {
    wheelAnimationFrame = null;
    const deltaPixels = pendingWheelDelta;
    pendingWheelDelta = 0;
    const factor = zoomFactorFromWheelDelta(deltaPixels);
    if (factor !== null) setViewBox(zoomAround(svg, viewBox, factor, pendingWheelClientX, pendingWheelClientY));
  }

  function touchPoints(): readonly TouchPoint[] {
    return [...touchPointers.values()];
  }

  function touchDistance(points: readonly TouchPoint[]): number {
    if (points.length < 2) return 0;
    return Math.hypot(points[1]!.clientX - points[0]!.clientX, points[1]!.clientY - points[0]!.clientY);
  }

  function touchCenter(points: readonly TouchPoint[]): TouchPoint {
    if (points.length < 2) return points[0] ?? { clientX: 0, clientY: 0 };
    return { clientX: (points[0]!.clientX + points[1]!.clientX) / 2, clientY: (points[0]!.clientY + points[1]!.clientY) / 2 };
  }

  function startPinchGesture(): void {
    const points = touchPoints();
    if (points.length < 2) return;
    const center = touchCenter(points);
    pinchState = { viewBox: { ...viewBox }, distance: Math.max(1, touchDistance(points)), centerX: center.clientX, centerY: center.clientY };
    panState = null;
  }

  function applyPinchGesture(): void {
    if (!pinchState) return;
    const points = touchPoints();
    if (points.length < 2) return;
    const center = touchCenter(points);
    const factor = pinchState.distance / Math.max(1, touchDistance(points));
    const zoomed = zoomAround(svg, pinchState.viewBox, factor, pinchState.centerX, pinchState.centerY);
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / zoomed.width || 1, rect.height / zoomed.height || 1);
    const renderedWidth = zoomed.width * scale;
    const renderedHeight = zoomed.height * scale;
    const deltaX = renderedWidth > 0 ? ((center.clientX - pinchState.centerX) / renderedWidth) * zoomed.width : 0;
    const deltaY = renderedHeight > 0 ? ((center.clientY - pinchState.centerY) / renderedHeight) * zoomed.height : 0;
    setViewBox({ ...zoomed, x: zoomed.x - deltaX, y: zoomed.y - deltaY });
  }

  const eventOptions = options.signal ? { signal: options.signal } : undefined;
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      markViewportInteraction();
      pendingWheelDelta += wheelDeltaYToPixels(event);
      pendingWheelClientX = event.clientX;
      pendingWheelClientY = event.clientY;
      if (wheelAnimationFrame === null) wheelAnimationFrame = window.requestAnimationFrame(applyPendingWheelZoom);
    },
    { passive: false, ...(options.signal ? { signal: options.signal } : {}) },
  );

  svg.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      markViewportInteraction();
      cancelViewBoxAnimation();
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("is-panning");
      if (event.pointerType === "touch") {
        touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        if (touchPointers.size >= 2) {
          startPinchGesture();
          return;
        }
      }
      panState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, viewBox: { ...viewBox } };
    },
    eventOptions,
  );

  svg.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") {
        if (!touchPointers.has(event.pointerId)) return;
        event.preventDefault();
        touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        if (touchPointers.size >= 2) {
          applyPinchGesture();
          return;
        }
      }
      if (!panState || panState.pointerId !== event.pointerId) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / panState.viewBox.width || 1, rect.height / panState.viewBox.height || 1);
      const renderedWidth = panState.viewBox.width * scale;
      const renderedHeight = panState.viewBox.height * scale;
      const deltaX = renderedWidth > 0 ? ((event.clientX - panState.clientX) / renderedWidth) * panState.viewBox.width : 0;
      const deltaY = renderedHeight > 0 ? ((event.clientY - panState.clientY) / renderedHeight) * panState.viewBox.height : 0;
      setViewBox({ ...panState.viewBox, x: panState.viewBox.x - deltaX, y: panState.viewBox.y - deltaY });
    },
    eventOptions,
  );

  function finishPan(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      touchPointers.delete(event.pointerId);
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      if (pinchState) {
        pinchState = null;
        const remaining = [...touchPointers.entries()][0];
        if (remaining) {
          const [pointerId, point] = remaining;
          panState = { pointerId, clientX: point.clientX, clientY: point.clientY, viewBox: { ...viewBox } };
          return;
        }
      }
      panState = null;
      if (touchPointers.size === 0) svg.classList.remove("is-panning");
      return;
    }
    if (!panState || panState.pointerId !== event.pointerId) return;
    panState = null;
    svg.classList.remove("is-panning");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }


  svg.addEventListener("pointerup", finishPan, eventOptions);
  svg.addEventListener("pointercancel", finishPan, eventOptions);
  svg.addEventListener("dragstart", (event) => event.preventDefault(), eventOptions);
  svg.addEventListener(
    "dblclick",
    () => {
      markViewportInteraction();
      resetView();
    },
    eventOptions,
  );
  svg.addEventListener(
    "keydown",
    (event) => {
      const center = svg.getBoundingClientRect();
      const clientX = center.left + center.width / 2;
      const clientY = center.top + center.height / 2;
      if (event.key === "+" || event.key === "=") setViewBox(zoomAround(svg, viewBox, ZOOM_IN_FACTOR, clientX, clientY));
      else if (event.key === "-") setViewBox(zoomAround(svg, viewBox, ZOOM_OUT_FACTOR, clientX, clientY));
      else if (event.key === "0" || event.key === "Escape") resetView();
      else if (event.key === "ArrowLeft") setViewBox({ ...viewBox, x: viewBox.x - viewBox.width * 0.12 });
      else if (event.key === "ArrowRight") setViewBox({ ...viewBox, x: viewBox.x + viewBox.width * 0.12 });
      else if (event.key === "ArrowUp") setViewBox({ ...viewBox, y: viewBox.y - viewBox.height * 0.12 });
      else if (event.key === "ArrowDown") setViewBox({ ...viewBox, y: viewBox.y + viewBox.height * 0.12 });
      else return;
      markViewportInteraction();
      event.preventDefault();
      event.stopPropagation();
    },
    eventOptions,
  );
  options.signal?.addEventListener(
    "abort",
    () => {
      cancelViewBoxAnimation();
      if (wheelAnimationFrame !== null) window.cancelAnimationFrame(wheelAnimationFrame);
    },
    { once: true },
  );

  function update(guessedCountryIds: ReadonlySet<CountryId>, currentCountryId: CountryId | null, latestCountryId: CountryId | null, labels: CapitalRecallUpdateLabels = {}): void {
    const recentLabelIds = new Set(recentCountries(countryIndex, guessedCountryIds, RECENT_LABEL_COUNT).map((country) => country.id));
    for (const [countryId, path] of pathByCountryId) {
      path.classList.toggle("is-solved", guessedCountryIds.has(countryId));
      path.classList.toggle("is-current", countryId === currentCountryId);
    }

    for (const [countryId, marker] of markerByCountryId) {
      const solved = guessedCountryIds.has(countryId);
      const latest = countryId === latestCountryId;
      marker.group.classList.toggle("is-solved", solved);
      marker.group.classList.toggle("is-current", countryId === currentCountryId);
      marker.group.classList.toggle("is-latest", latest);
      marker.label.classList.toggle("is-recent", recentLabelIds.has(countryId));
      if (latest && latestCountryId !== previousLatestCountryId) {
        marker.group.classList.remove("is-popping");
        marker.group.getBoundingClientRect();
        marker.group.classList.add("is-popping");
      }
    }

    previousLatestCountryId = latestCountryId;
    const currentCountry = currentCountryId === null ? null : countryIndex.byId[currentCountryId] ?? null;
    currentPrefix.textContent = labels.prefixLabel ?? "Capital of";
    currentName.textContent = currentCountry?.name ?? labels.emptyLabel ?? "Complete";
    progress.textContent = `${Math.min(guessedCountryIds.size, playableCapitalTotal)} / ${playableCapitalTotal}`;

    const recent = recentCountries(countryIndex, guessedCountryIds, RECENT_LIST_COUNT);
    recentList.hidden = recent.length === 0;
    recentList.replaceChildren(
      ...recent.map((country) =>
        el("span", {
          className: "capital-map-recent-chip",
          children: [el("strong", { text: country.capital }), el("span", { text: country.code })],
        }),
      ),
    );

    updateViewportPresentation();
  }

  update(new Set(), null, null);

  return { element, update };
}
