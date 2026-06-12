import type { Continent, Country, CountryId, CountryIndex } from "../../core/countries";
import { projectWorldMapPosition, type WorldCountryFeature, type WorldMapPolygon, type WorldMapPosition } from "../../core/map";

const SVG_NS = "http://www.w3.org/2000/svg";
const BOARD_WIDTH = 820;
const BOARD_HEIGHT = 560;
const BOARD_PADDING = 34;
const MINI_PATH_PADDING_RATIO = 0.16;
const PERFECT_PLACEMENT_DISTANCE = 6;
const ZERO_ACCURACY_DISTANCE = 130;
const CLOSE_PLACEMENT_DISTANCE = 28;
const MAX_ZOOM = 12;
const ZOOM_IN_FACTOR = 0.78;
const ZOOM_OUT_FACTOR = 1.22;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const WHEEL_DELTA_LINE_PIXELS = 40;
const WHEEL_DELTA_PAGE_PIXELS = 800;
const MAX_WHEEL_DELTA_PIXELS = 140;
const MIN_WHEEL_DELTA_PIXELS = 0.35;
const DEFAULT_BOARD_VIEWBOX: ViewBoxState = { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT };

type Point = readonly [number, number];

type ProjectTransform = (point: WorldMapPosition) => Point;

interface ViewBoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardPanState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly viewBox: ViewBoxState;
  hasMoved: boolean;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface PuzzlePiece {
  readonly country: Country;
  readonly feature: WorldCountryFeature;
  readonly path: SVGPathElement;
  readonly card: HTMLButtonElement;
  readonly correctCenter: Point;
  dx: number;
  dy: number;
  visible: boolean;
  placed: boolean;
}

interface ActiveDrag {
  readonly piece: PuzzlePiece;
  readonly pointerOffsetX: number;
  readonly pointerOffsetY: number;
  readonly abortController: AbortController;
}

export interface PuzzleMapProgress {
  readonly placedCount: number;
  readonly totalCount: number;
  readonly lastCountry: Country | null;
  readonly complete: boolean;
}

export interface PuzzleMapAccuracy {
  readonly placedCount: number;
  readonly totalCount: number;
  readonly accuracyPercent: number;
  readonly averageDistance: number;
  readonly closeCount: number;
  readonly complete: boolean;
}

export interface PuzzleMapViewOptions {
  readonly signal?: AbortSignal;
  readonly onFirstPlacement?: () => void;
  readonly onProgress?: (progress: PuzzleMapProgress) => void;
  readonly onComplete?: (progress: PuzzleMapProgress) => void;
}

export interface PuzzleMapView {
  readonly element: HTMLElement;
  readonly setContinent: (continent: Continent) => void;
  readonly reset: () => void;
  readonly getState: () => PuzzleMapProgress;
  readonly checkAccuracy: () => PuzzleMapAccuracy;
  readonly destroy: () => void;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function project(point: WorldMapPosition): Point {
  return projectWorldMapPosition(point);
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

function clampBoardViewBox(viewBox: ViewBoxState): ViewBoxState {
  const minWidth = BOARD_WIDTH / MAX_ZOOM;
  const width = Math.min(BOARD_WIDTH, Math.max(minWidth, viewBox.width));
  const height = width * (BOARD_HEIGHT / BOARD_WIDTH);
  const maxX = BOARD_WIDTH - width;
  const maxY = BOARD_HEIGHT - height;

  return {
    x: Math.min(maxX, Math.max(0, viewBox.x)),
    y: Math.min(maxY, Math.max(0, viewBox.y)),
    width,
    height,
  };
}

function pointerToViewBoxPosition(svg: SVGSVGElement, viewBox: ViewBoxState, clientX: number, clientY: number): Point {
  const rect = svg.getBoundingClientRect();
  const relativeX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const relativeY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return [viewBox.x + relativeX * viewBox.width, viewBox.y + relativeY * viewBox.height];
}

function zoomBoardAround(svg: SVGSVGElement, viewBox: ViewBoxState, factor: number, clientX: number, clientY: number): ViewBoxState {
  const [mapX, mapY] = pointerToViewBoxPosition(svg, viewBox, clientX, clientY);
  const nextWidth = viewBox.width * factor;
  const nextHeight = viewBox.height * factor;
  const widthRatio = nextWidth / viewBox.width;
  const heightRatio = nextHeight / viewBox.height;

  return clampBoardViewBox({
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

  const boundedDelta = clampNumber(deltaPixels, -MAX_WHEEL_DELTA_PIXELS, MAX_WHEEL_DELTA_PIXELS);
  return Math.exp(boundedDelta * WHEEL_ZOOM_SENSITIVITY);
}

function expandBounds(bounds: Bounds | null, [x, y]: Point): Bounds {
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

function featureBounds(feature: WorldCountryFeature, transform: ProjectTransform = project): Bounds | null {
  let bounds: Bounds | null = null;
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const point of ring) bounds = expandBounds(bounds, transform(point));
    }
  }

  return bounds;
}

function mergeBounds(features: readonly WorldCountryFeature[]): Bounds | null {
  let bounds: Bounds | null = null;

  for (const feature of features) {
    const nextBounds = featureBounds(feature);
    if (!nextBounds) continue;
    bounds = expandBounds(bounds, [nextBounds.minX, nextBounds.minY]);
    bounds = expandBounds(bounds, [nextBounds.maxX, nextBounds.maxY]);
  }

  return bounds;
}

function boundsCenter(bounds: Bounds): Point {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

function createContinentTransform(bounds: Bounds): ProjectTransform {
  const rawWidth = Math.max(1, bounds.maxX - bounds.minX);
  const rawHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((BOARD_WIDTH - BOARD_PADDING * 2) / rawWidth, (BOARD_HEIGHT - BOARD_PADDING * 2) / rawHeight);
  const contentWidth = rawWidth * scale;
  const contentHeight = rawHeight * scale;
  const offsetX = (BOARD_WIDTH - contentWidth) / 2;
  const offsetY = (BOARD_HEIGHT - contentHeight) / 2;

  return (point) => {
    const [x, y] = project(point);
    return [offsetX + (x - bounds.minX) * scale, offsetY + (y - bounds.minY) * scale];
  };
}

function formatPoint(point: WorldMapPosition, transform: ProjectTransform): string {
  const [x, y] = transform(point);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

function polygonToPath(polygon: WorldMapPolygon, transform: ProjectTransform): string {
  return polygon
    .map((ring) => ring.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPoint(point, transform)}`).join(" ") + " Z")
    .join(" ");
}

function geometryToPath(feature: WorldCountryFeature, transform: ProjectTransform): string {
  if (feature.geometry.type === "Polygon") return polygonToPath(feature.geometry.coordinates, transform);
  return feature.geometry.coordinates.map((polygon) => polygonToPath(polygon, transform)).join(" ");
}

function pointerToSvgPosition(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return [BOARD_WIDTH / 2, BOARD_HEIGHT / 2];

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(ctm.inverse());
  return [transformed.x, transformed.y];
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function updatePieceTransform(piece: PuzzlePiece): void {
  piece.path.setAttribute("transform", `translate(${piece.dx.toFixed(3)} ${piece.dy.toFixed(3)})`);
}

function pieceProgress(pieces: readonly PuzzlePiece[], lastCountry: Country | null = null): PuzzleMapProgress {
  const placedCount = pieces.filter((piece) => piece.placed).length;
  return {
    placedCount,
    totalCount: pieces.length,
    lastCountry,
    complete: pieces.length > 0 && placedCount >= pieces.length,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scorePieceDistance(distance: number): number {
  if (distance <= PERFECT_PLACEMENT_DISTANCE) return 1;
  const adjustedDistance = distance - PERFECT_PLACEMENT_DISTANCE;
  const scoringRange = ZERO_ACCURACY_DISTANCE - PERFECT_PLACEMENT_DISTANCE;
  return clampNumber(1 - adjustedDistance / scoringRange, 0, 1);
}

function pieceDistanceFromTarget(piece: PuzzlePiece): number {
  return piece.placed ? Math.hypot(piece.dx, piece.dy) : ZERO_ACCURACY_DISTANCE;
}

function pieceAccuracy(pieces: readonly PuzzlePiece[]): PuzzleMapAccuracy {
  const placedCount = pieces.filter((piece) => piece.placed).length;
  const totalDistance = pieces.reduce((sum, piece) => sum + pieceDistanceFromTarget(piece), 0);
  const totalScore = pieces.reduce((sum, piece) => sum + scorePieceDistance(pieceDistanceFromTarget(piece)), 0);
  const closeCount = pieces.filter((piece) => piece.placed && pieceDistanceFromTarget(piece) <= CLOSE_PLACEMENT_DISTANCE).length;
  const totalCount = pieces.length;

  return {
    placedCount,
    totalCount,
    accuracyPercent: totalCount > 0 ? Math.round((totalScore / totalCount) * 100) : 0,
    averageDistance: totalCount > 0 ? totalDistance / totalCount : 0,
    closeCount,
    complete: totalCount > 0 && placedCount >= totalCount,
  };
}

function createMiniSvg(feature: WorldCountryFeature, countryName: string): SVGSVGElement {
  const svg = createSvgElement("svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "puzzle-piece-card-svg");

  const bounds = featureBounds(feature);
  if (!bounds) return svg;

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const padding = Math.max(width, height) * MINI_PATH_PADDING_RATIO;
  svg.setAttribute("viewBox", `${(bounds.minX - padding).toFixed(3)} ${(bounds.minY - padding).toFixed(3)} ${(width + padding * 2).toFixed(3)} ${(height + padding * 2).toFixed(3)}`);

  const title = createSvgElement("title");
  title.textContent = countryName;
  const path = createSvgElement("path");
  path.setAttribute("d", geometryToPath(feature, project));
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.classList.add("puzzle-piece-card-path");
  svg.append(title, path);
  return svg;
}

function signalAny(signals: readonly AbortSignal[]): AbortSignal | undefined {
  const filtered = signals.filter(Boolean);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];

  const controller = new AbortController();
  for (const signal of filtered) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export function createPuzzleMapView(
  features: readonly WorldCountryFeature[],
  countryIndex: CountryIndex,
  initialContinent: Continent,
  options: PuzzleMapViewOptions = {},
): PuzzleMapView {
  const controller = new AbortController();
  const signal = signalAny([controller.signal, ...(options.signal ? [options.signal] : [])]) ?? controller.signal;
  const featureByCountryId = new Map<CountryId, WorldCountryFeature>();

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    if (country) featureByCountryId.set(country.id, feature);
  }

  const element = document.createElement("div");
  element.className = "puzzle-map-panel";

  const boardShell = document.createElement("div");
  boardShell.className = "puzzle-board-shell";

  const svg = createSvgElement("svg");
  svg.setAttribute("class", "puzzle-board-svg");
  svg.setAttribute("viewBox", `0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Continent puzzle board. Drag country cutouts into position, then check your accuracy.");

  const continentLayer = createSvgElement("g");
  continentLayer.setAttribute("class", "puzzle-continent-layer");
  const outlineLayer = createSvgElement("g");
  outlineLayer.setAttribute("class", "puzzle-target-layer");
  const pieceLayer = createSvgElement("g");
  pieceLayer.setAttribute("class", "puzzle-piece-layer");
  svg.append(continentLayer, outlineLayer, pieceLayer);

  const tray = document.createElement("div");
  tray.className = "puzzle-piece-tray";
  tray.setAttribute("aria-label", "Country puzzle pieces");

  const borderToggleLabel = document.createElement("label");
  borderToggleLabel.className = "puzzle-border-toggle";
  const borderToggle = document.createElement("input");
  borderToggle.type = "checkbox";
  borderToggle.className = "puzzle-border-toggle-input";
  borderToggle.checked = false;
  const borderToggleText = document.createElement("span");
  borderToggleText.textContent = "Show country borders";
  borderToggleLabel.append(borderToggle, borderToggleText);

  const zoomInButton = createButton("+", "Zoom in");
  const zoomOutButton = createButton("−", "Zoom out");
  const resetViewButton = createButton("Reset", "Reset puzzle board zoom and position");
  const controls = document.createElement("div");
  controls.className = "world-map-controls puzzle-board-controls";
  controls.append(zoomInButton, zoomOutButton, resetViewButton);

  boardShell.append(svg, controls, borderToggleLabel);
  element.append(boardShell, tray);

  let continent: Continent = initialContinent;
  let showCountryBorders = false;
  let pieces: PuzzlePiece[] = [];
  let activeDrag: ActiveDrag | null = null;
  let lastCountry: Country | null = null;
  let viewBox: ViewBoxState = { ...DEFAULT_BOARD_VIEWBOX };
  let boardPanState: BoardPanState | null = null;
  let pendingWheelDelta = 0;
  let pendingWheelClientX = 0;
  let pendingWheelClientY = 0;
  let wheelAnimationFrame: number | null = null;

  function setViewBox(nextViewBox: ViewBoxState): void {
    viewBox = clampBoardViewBox(nextViewBox);
    applyViewBox(svg, viewBox);
  }

  function resetViewBox(): void {
    setViewBox(DEFAULT_BOARD_VIEWBOX);
  }

  function applyPendingWheelZoom(): void {
    wheelAnimationFrame = null;
    const deltaPixels = pendingWheelDelta;
    pendingWheelDelta = 0;

    const factor = zoomFactorFromWheelDelta(deltaPixels);
    if (factor === null) return;

    setViewBox(zoomBoardAround(svg, viewBox, factor, pendingWheelClientX, pendingWheelClientY));
  }

  function isPuzzlePieceTarget(target: EventTarget | null): boolean {
    const element = target instanceof Element ? target : null;
    return element?.closest(".puzzle-country-piece") !== null;
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    pendingWheelDelta += wheelDeltaYToPixels(event);
    pendingWheelClientX = event.clientX;
    pendingWheelClientY = event.clientY;

    if (wheelAnimationFrame === null) {
      wheelAnimationFrame = window.requestAnimationFrame(applyPendingWheelZoom);
    }
  }, { passive: false, signal });

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isPuzzlePieceTarget(event.target)) return;
    event.preventDefault();
    boardPanState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox: { ...viewBox },
      hasMoved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  }, { signal });

  svg.addEventListener("pointermove", (event) => {
    if (!boardPanState || boardPanState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const rawDeltaX = event.clientX - boardPanState.clientX;
    const rawDeltaY = event.clientY - boardPanState.clientY;
    if (rawDeltaX * rawDeltaX + rawDeltaY * rawDeltaY > 16) boardPanState.hasMoved = true;
    const deltaX = rect.width > 0 ? (rawDeltaX / rect.width) * boardPanState.viewBox.width : 0;
    const deltaY = rect.height > 0 ? (rawDeltaY / rect.height) * boardPanState.viewBox.height : 0;
    setViewBox({ ...boardPanState.viewBox, x: boardPanState.viewBox.x - deltaX, y: boardPanState.viewBox.y - deltaY });
  }, { signal });

  function finishBoardPan(event: PointerEvent): void {
    if (!boardPanState || boardPanState.pointerId !== event.pointerId) return;
    boardPanState = null;
    svg.classList.remove("is-panning");
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }

  svg.addEventListener("pointerup", finishBoardPan, { signal });
  svg.addEventListener("pointercancel", finishBoardPan, { signal });
  svg.addEventListener("dblclick", resetViewBox, { signal });
  zoomInButton.addEventListener("click", () => setViewBox(zoomBoardAround(svg, viewBox, ZOOM_IN_FACTOR, svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2)), { signal });
  zoomOutButton.addEventListener("click", () => setViewBox(zoomBoardAround(svg, viewBox, ZOOM_OUT_FACTOR, svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2)), { signal });
  resetViewButton.addEventListener("click", resetViewBox, { signal });

  function setShowCountryBorders(nextValue: boolean): void {
    showCountryBorders = nextValue;
    borderToggle.checked = showCountryBorders;
    element.classList.toggle("show-country-borders", showCountryBorders);
  }

  borderToggle.addEventListener("change", () => setShowCountryBorders(borderToggle.checked), { signal });
  setShowCountryBorders(false);

  function currentProgress(country: Country | null = lastCountry): PuzzleMapProgress {
    return pieceProgress(pieces, country);
  }

  function emitProgress(country: Country | null = lastCountry): PuzzleMapProgress {
    const progress = currentProgress(country);
    options.onProgress?.(progress);
    return progress;
  }

  function cancelActiveDrag(): void {
    activeDrag?.abortController.abort();
    activeDrag?.piece.path.classList.remove("is-dragging");
    activeDrag = null;
  }

  function finishDrag(): void {
    if (!activeDrag) return;

    const piece = activeDrag.piece;
    cancelActiveDrag();

    const wasPlaced = piece.placed;
    piece.visible = true;
    piece.placed = true;
    updatePieceTransform(piece);
    piece.path.classList.remove("is-loose", "is-accuracy-close", "is-accuracy-far");
    piece.path.classList.add("is-placed");
    piece.card.hidden = true;
    lastCountry = piece.country;

    if (!wasPlaced) options.onFirstPlacement?.();
    emitProgress(piece.country);
  }

  function moveDrag(event: PointerEvent): void {
    if (!activeDrag) return;
    event.preventDefault();
    const piece = activeDrag.piece;
    const [x, y] = pointerToSvgPosition(svg, event.clientX, event.clientY);
    const nextCenterX = clampNumber(x - activeDrag.pointerOffsetX, 0, BOARD_WIDTH);
    const nextCenterY = clampNumber(y - activeDrag.pointerOffsetY, 0, BOARD_HEIGHT);
    piece.dx = nextCenterX - piece.correctCenter[0];
    piece.dy = nextCenterY - piece.correctCenter[1];
    updatePieceTransform(piece);
  }

  function startDrag(piece: PuzzlePiece, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    cancelActiveDrag();

    const [x, y] = pointerToSvgPosition(svg, event.clientX, event.clientY);
    if (!piece.visible) {
      piece.visible = true;
      piece.dx = x - piece.correctCenter[0];
      piece.dy = y - piece.correctCenter[1];
      piece.path.style.display = "";
      updatePieceTransform(piece);
      piece.card.classList.add("is-in-play");
    }

    pieceLayer.append(piece.path);
    piece.path.classList.add("is-dragging");
    piece.path.classList.remove("is-loose", "is-accuracy-close", "is-accuracy-far");

    const abortController = new AbortController();
    const dragSignal = signalAny([abortController.signal, controller.signal, ...(options.signal ? [options.signal] : [])]) ?? abortController.signal;
    activeDrag = {
      piece,
      pointerOffsetX: x - (piece.correctCenter[0] + piece.dx),
      pointerOffsetY: y - (piece.correctCenter[1] + piece.dy),
      abortController,
    };

    window.addEventListener("pointermove", moveDrag, { signal: dragSignal });
    window.addEventListener("pointerup", finishDrag, { signal: dragSignal, once: true });
    window.addEventListener("pointercancel", finishDrag, { signal: dragSignal, once: true });
  }

  function buildContinent(nextContinent: Continent): void {
    cancelActiveDrag();
    continent = nextContinent;
    lastCountry = null;
    pieces = [];
    resetViewBox();
    continentLayer.replaceChildren();
    outlineLayer.replaceChildren();
    pieceLayer.replaceChildren();
    tray.replaceChildren();

    const countries = countryIndex.countries.filter((country) => country.continent === continent && featureByCountryId.has(country.id));
    const continentFeatures = countries.map((country) => featureByCountryId.get(country.id)!).filter(Boolean);
    const bounds = mergeBounds(continentFeatures);
    if (!bounds) {
      const empty = document.createElement("p");
      empty.className = "puzzle-tray-empty";
      empty.textContent = "No outline data found for this continent yet.";
      tray.append(empty);
      return;
    }

    const transform = createContinentTransform(bounds);

    for (const country of countries) {
      const feature = featureByCountryId.get(country.id)!;
      const pathData = geometryToPath(feature, transform);
      const localBounds = featureBounds(feature, transform);
      if (!localBounds) continue;
      const center = boundsCenter(localBounds);

      const silhouette = createSvgElement("path");
      silhouette.setAttribute("d", pathData);
      silhouette.classList.add("puzzle-continent-silhouette-country");
      continentLayer.append(silhouette);

      const target = createSvgElement("path");
      target.setAttribute("d", pathData);
      target.setAttribute("vector-effect", "non-scaling-stroke");
      target.classList.add("puzzle-target-country");
      outlineLayer.append(target);

      const piecePath = createSvgElement("path");
      piecePath.setAttribute("d", pathData);
      piecePath.setAttribute("vector-effect", "non-scaling-stroke");
      piecePath.dataset.countryId = String(country.id);
      piecePath.classList.add("puzzle-country-piece");
      piecePath.style.display = "none";
      piecePath.setAttribute("aria-label", country.name);
      pieceLayer.append(piecePath);

      const card = document.createElement("button");
      card.type = "button";
      card.className = "puzzle-piece-card";
      card.setAttribute("aria-label", `Drag ${country.name}`);
      const name = document.createElement("span");
      name.className = "puzzle-piece-card-name";
      name.textContent = country.name;
      card.append(createMiniSvg(feature, country.name), name);

      const piece: PuzzlePiece = { country, feature, path: piecePath, card, correctCenter: center, dx: 0, dy: 0, visible: false, placed: false };
      pieces.push(piece);

      piecePath.addEventListener("pointerdown", (event) => startDrag(piece, event), { signal });
      card.addEventListener("pointerdown", (event) => startDrag(piece, event), { signal });
    }

    for (const piece of shuffle(pieces)) tray.append(piece.card);
  }

  buildContinent(initialContinent);

  function checkAccuracy(): PuzzleMapAccuracy {
    const accuracy = pieceAccuracy(pieces);
    for (const piece of pieces) {
      const isClose = piece.placed && pieceDistanceFromTarget(piece) <= CLOSE_PLACEMENT_DISTANCE;
      piece.path.classList.toggle("is-accuracy-close", isClose);
      piece.path.classList.toggle("is-accuracy-far", piece.placed && !isClose);
    }
    return accuracy;
  }

  return {
    element,
    setContinent: (nextContinent) => buildContinent(nextContinent),
    reset: () => buildContinent(continent),
    getState: () => currentProgress(),
    checkAccuracy,
    destroy: () => {
      cancelActiveDrag();
      controller.abort();
    },
  };
}
