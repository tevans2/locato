import type { CountryId, CountryIndex } from "../../core/countries";
import type { WorldCountryFeature, WorldMapPosition, WorldMapRing } from "../../core/map";

const TAU = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.65;
const ROTATION_SPEED = 0.000035;
const DRAG_ROTATION_SCALE = 0.0085;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const FOCUS_ANIMATION_MS = 520;
const HIDDEN_Z = 0.018;

type GlobePoint = readonly [longitudeRad: number, latitudeRad: number];

type ProjectedGlobePoint = readonly [x: number, y: number, z: number];

interface GlobeRing {
  readonly points: readonly GlobePoint[];
}

interface GlobeShape {
  readonly countryId: CountryId | null;
  readonly rings: readonly GlobeRing[];
}

interface GlobeMarker {
  readonly countryId: CountryId;
  readonly longitudeRad: number;
  readonly latitudeRad: number;
}

interface GlobeDragState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface GlobeMapView {
  readonly element: HTMLElement;
  readonly highlightedCount: HTMLElement;
  readonly remainingCount: HTMLElement;
  readonly focusCountry: (countryId: CountryId) => void;
  readonly resetView: () => void;
  readonly setMissingMarkersVisible: (visible: boolean) => void;
  readonly update: (guessedCountryIds: ReadonlySet<CountryId>, totalCountries: number) => void;
  readonly destroy: () => void;
}

function createButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "world-map-control-button";
  button.type = "button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function toGlobePoint([longitude, latitude]: WorldMapPosition): GlobePoint {
  return [longitude * DEG_TO_RAD, latitude * DEG_TO_RAD];
}

function ringToGlobeRing(ring: WorldMapRing): GlobeRing {
  return { points: ring.map(toGlobePoint) };
}

function featureRings(feature: WorldCountryFeature): readonly GlobeRing[] {
  if (feature.geometry.type === "Polygon") return feature.geometry.coordinates.map(ringToGlobeRing);
  return feature.geometry.coordinates.flatMap((polygon) => polygon.map(ringToGlobeRing));
}

function normalizeRadians(value: number): number {
  let normalized = value % TAU;
  if (normalized <= -Math.PI) normalized += TAU;
  if (normalized > Math.PI) normalized -= TAU;
  return normalized;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageAngles(values: readonly number[]): number {
  let x = 0;
  let y = 0;
  for (const value of values) {
    x += Math.cos(value);
    y += Math.sin(value);
  }
  return Math.atan2(y, x);
}

function markerForRings(countryId: CountryId, rings: readonly GlobeRing[]): GlobeMarker | null {
  const longitudes: number[] = [];
  let latitudeSum = 0;
  let pointCount = 0;

  for (const ring of rings) {
    for (const point of ring.points) {
      longitudes.push(point[0]);
      latitudeSum += point[1];
      pointCount += 1;
    }
  }

  if (pointCount === 0) return null;
  return { countryId, longitudeRad: averageAngles(longitudes), latitudeRad: latitudeSum / pointCount };
}

function projectPoint(point: GlobePoint, yaw: number, pitch: number, radius: number, centerX: number, centerY: number): ProjectedGlobePoint {
  const longitude = point[0] + yaw;
  const latitude = point[1];
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const x = cosLatitude * sinLongitude;
  const y = sinLatitude * cosPitch - cosLatitude * cosLongitude * sinPitch;
  const z = sinLatitude * sinPitch + cosLatitude * cosLongitude * cosPitch;
  return [centerX + radius * x, centerY - radius * y, z];
}

function drawRingPath(context: CanvasRenderingContext2D, ring: GlobeRing, yaw: number, pitch: number, radius: number, centerX: number, centerY: number): boolean {
  let started = false;
  let visiblePoints = 0;

  for (const point of ring.points) {
    const projected = projectPoint(point, yaw, pitch, radius, centerX, centerY);
    if (projected[2] <= HIDDEN_Z) continue;

    if (started) context.lineTo(projected[0], projected[1]);
    else {
      context.moveTo(projected[0], projected[1]);
      started = true;
    }
    visiblePoints += 1;
  }

  if (visiblePoints < 3) return false;
  context.closePath();
  return true;
}

function drawGraticule(context: CanvasRenderingContext2D, yaw: number, pitch: number, radius: number, centerX: number, centerY: number): void {
  context.save();
  context.strokeStyle = "rgba(191, 220, 213, 0.11)";
  context.lineWidth = Math.max(1, radius * 0.0022);

  for (let latitude = -60; latitude <= 60; latitude += 30) {
    context.beginPath();
    let started = false;
    for (let longitude = -180; longitude <= 180; longitude += 4) {
      const projected = projectPoint([longitude * DEG_TO_RAD, latitude * DEG_TO_RAD], yaw, pitch, radius, centerX, centerY);
      if (projected[2] <= 0) {
        started = false;
        continue;
      }
      if (started) context.lineTo(projected[0], projected[1]);
      else {
        context.moveTo(projected[0], projected[1]);
        started = true;
      }
    }
    context.stroke();
  }

  for (let longitude = -150; longitude <= 180; longitude += 30) {
    context.beginPath();
    let started = false;
    for (let latitude = -80; latitude <= 80; latitude += 3) {
      const projected = projectPoint([longitude * DEG_TO_RAD, latitude * DEG_TO_RAD], yaw, pitch, radius, centerX, centerY);
      if (projected[2] <= 0) {
        started = false;
        continue;
      }
      if (started) context.lineTo(projected[0], projected[1]);
      else {
        context.moveTo(projected[0], projected[1]);
        started = true;
      }
    }
    context.stroke();
  }

  context.restore();
}

export function createGlobeMapView(features: readonly WorldCountryFeature[], countryIndex: CountryIndex): GlobeMapView {
  const canvas = document.createElement("canvas");
  canvas.className = "globe-map-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Interactive 3D globe. Drag to rotate and scroll to zoom.");

  const canvasContext = canvas.getContext("2d", { alpha: true });
  if (canvasContext === null) throw new Error("Unable to create globe canvas context.");
  const context: CanvasRenderingContext2D = canvasContext;

  const shapes: GlobeShape[] = [];
  const markers: GlobeMarker[] = [];
  const markerByCountryId = new Map<CountryId, GlobeMarker>();

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase()) ?? null;
    const rings = featureRings(feature);
    shapes.push({ countryId: country?.id ?? null, rings });
    if (country) {
      const marker = markerForRings(country.id, rings);
      if (marker) {
        markers.push(marker);
        markerByCountryId.set(country.id, marker);
      }
    }
  }

  const highlightedCount = document.createElement("strong");
  highlightedCount.textContent = "0";
  const remainingCount = document.createElement("strong");
  remainingCount.textContent = String(countryIndex.countries.length);

  const zoomInButton = createButton("+", "Zoom in");
  const zoomOutButton = createButton("−", "Zoom out");
  const resetViewButton = createButton("Reset", "Reset globe rotation and zoom");
  const controls = document.createElement("div");
  controls.className = "world-map-controls";
  controls.append(zoomInButton, zoomOutButton, resetViewButton);

  const meta = document.createElement("div");
  meta.className = "world-map-meta globe-map-meta";
  meta.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  meta.children[0]!.append("Found ", highlightedCount);
  meta.children[1]!.append("Left ", remainingCount);
  meta.children[2]!.textContent = "Drag globe";

  const element = document.createElement("div");
  element.className = "world-map-panel globe-map-panel";
  element.append(canvas, controls, meta);

  let guessedCountryIds: ReadonlySet<CountryId> = new Set();
  let showMissingMarkers = false;
  let yaw = -18 * DEG_TO_RAD;
  let pitch = 8 * DEG_TO_RAD;
  let scale = 1;
  let dragState: GlobeDragState | null = null;
  let frameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let destroyed = false;
  let userControlled = false;
  let focusAnimationFrame: number | null = null;

  function scheduleDraw(): void {
    if (frameId !== null) return;
    frameId = window.requestAnimationFrame(draw);
  }

  function sizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      scheduleDraw();
    }
  }

  function draw(now = performance.now()): void {
    frameId = null;
    if (destroyed) return;

    sizeCanvas();
    if (!userControlled && !dragState) yaw = normalizeRadians(yaw + ROTATION_SPEED * now * 0.16);

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const radius = Math.min(width, height) * 0.405 * scale;

    context.clearRect(0, 0, width, height);

    const atmosphere = context.createRadialGradient(centerX - radius * 0.34, centerY - radius * 0.38, radius * 0.1, centerX, centerY, radius * 1.12);
    atmosphere.addColorStop(0, "rgba(128, 222, 255, 0.24)");
    atmosphere.addColorStop(0.52, "rgba(37, 89, 118, 0.28)");
    atmosphere.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = atmosphere;
    context.beginPath();
    context.arc(centerX, centerY, radius * 1.12, 0, TAU);
    context.fill();

    const ocean = context.createRadialGradient(centerX - radius * 0.26, centerY - radius * 0.34, radius * 0.12, centerX, centerY, radius);
    ocean.addColorStop(0, "#123a48");
    ocean.addColorStop(0.58, "#071b26");
    ocean.addColorStop(1, "#02060b");
    context.fillStyle = ocean;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, TAU);
    context.fill();

    drawGraticule(context, yaw, pitch, radius, centerX, centerY);

    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, TAU);
    context.clip();

    for (const shape of shapes) {
      const guessed = shape.countryId !== null && guessedCountryIds.has(shape.countryId);
      context.beginPath();
      let hasVisibleRing = false;
      for (const ring of shape.rings) {
        hasVisibleRing = drawRingPath(context, ring, yaw, pitch, radius, centerX, centerY) || hasVisibleRing;
      }
      if (!hasVisibleRing) continue;

      context.fillStyle = guessed ? "rgba(125, 226, 179, 0.86)" : shape.countryId === null ? "rgba(163, 177, 178, 0.11)" : "rgba(188, 204, 194, 0.18)";
      context.strokeStyle = guessed ? "rgba(224, 255, 239, 0.82)" : "rgba(225, 237, 230, 0.18)";
      context.lineWidth = guessed ? Math.max(1.3, radius * 0.0024) : Math.max(0.7, radius * 0.0013);
      context.fill();
      context.stroke();
    }

    if (showMissingMarkers) {
      for (const marker of markers) {
        if (guessedCountryIds.has(marker.countryId)) continue;
        const projected = projectPoint([marker.longitudeRad, marker.latitudeRad], yaw, pitch, radius, centerX, centerY);
        if (projected[2] <= HIDDEN_Z) continue;
        const dotRadius = Math.max(2.2, radius * 0.006) * (0.78 + projected[2] * 0.34);
        context.beginPath();
        context.arc(projected[0], projected[1], dotRadius, 0, TAU);
        context.fillStyle = "rgba(255, 255, 255, 0.88)";
        context.strokeStyle = "rgba(2, 8, 10, 0.82)";
        context.lineWidth = Math.max(1, radius * 0.002);
        context.fill();
        context.stroke();
      }
    }

    context.restore();

    const rim = context.createRadialGradient(centerX - radius * 0.2, centerY - radius * 0.24, radius * 0.2, centerX, centerY, radius);
    rim.addColorStop(0, "rgba(255, 255, 255, 0)");
    rim.addColorStop(0.74, "rgba(120, 209, 234, 0.02)");
    rim.addColorStop(0.91, "rgba(148, 233, 255, 0.18)");
    rim.addColorStop(1, "rgba(214, 252, 255, 0.44)");
    context.strokeStyle = rim;
    context.lineWidth = Math.max(2, radius * 0.012);
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, TAU);
    context.stroke();

    if (!userControlled && !dragState) scheduleDraw();
  }

  function animateFocus(targetYaw: number, targetPitch: number): void {
    if (focusAnimationFrame !== null) window.cancelAnimationFrame(focusAnimationFrame);
    const startYaw = yaw;
    const startPitch = pitch;
    const yawDelta = normalizeRadians(targetYaw - startYaw);
    const startedAt = performance.now();

    function tick(now: number): void {
      const progress = clampNumber((now - startedAt) / FOCUS_ANIMATION_MS, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      yaw = normalizeRadians(startYaw + yawDelta * eased);
      pitch = startPitch + (targetPitch - startPitch) * eased;
      scheduleDraw();
      if (progress < 1) focusAnimationFrame = window.requestAnimationFrame(tick);
      else focusAnimationFrame = null;
    }

    focusAnimationFrame = window.requestAnimationFrame(tick);
  }

  function focusCountry(countryId: CountryId): void {
    const marker = markerByCountryId.get(countryId);
    if (!marker) return;
    userControlled = true;
    animateFocus(normalizeRadians(-marker.longitudeRad), clampNumber(marker.latitudeRad * 0.7, -0.9, 0.9));
  }

  function resetView(): void {
    userControlled = false;
    yaw = -18 * DEG_TO_RAD;
    pitch = 8 * DEG_TO_RAD;
    scale = 1;
    scheduleDraw();
  }

  function setMissingMarkersVisible(visible: boolean): void {
    showMissingMarkers = visible;
    element.classList.toggle("show-missing-countries", visible);
    scheduleDraw();
  }

  function update(nextGuessedCountryIds: ReadonlySet<CountryId>, totalCountries: number): void {
    guessedCountryIds = nextGuessedCountryIds;
    highlightedCount.textContent = String(nextGuessedCountryIds.size);
    remainingCount.textContent = String(Math.max(0, totalCountries - nextGuessedCountryIds.size));
    scheduleDraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    userControlled = true;
    dragState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, yaw, pitch };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-panning");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.clientX;
    const deltaY = event.clientY - dragState.clientY;
    yaw = normalizeRadians(dragState.yaw + deltaX * DRAG_ROTATION_SCALE);
    pitch = clampNumber(dragState.pitch + deltaY * DRAG_ROTATION_SCALE, -1.1, 1.1);
    scheduleDraw();
  });

  function finishDrag(event: PointerEvent): void {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    canvas.classList.remove("is-panning");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("dragstart", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    userControlled = true;
    scale = clampNumber(scale * (1 - event.deltaY * WHEEL_ZOOM_SENSITIVITY), MIN_SCALE, MAX_SCALE);
    scheduleDraw();
  }, { passive: false });

  zoomInButton.addEventListener("click", () => {
    userControlled = true;
    scale = clampNumber(scale * 1.12, MIN_SCALE, MAX_SCALE);
    scheduleDraw();
  });
  zoomOutButton.addEventListener("click", () => {
    userControlled = true;
    scale = clampNumber(scale / 1.12, MIN_SCALE, MAX_SCALE);
    scheduleDraw();
  });
  resetViewButton.addEventListener("click", resetView);

  resizeObserver = new ResizeObserver(() => {
    sizeCanvas();
    scheduleDraw();
  });
  resizeObserver.observe(canvas);
  scheduleDraw();

  return {
    element,
    highlightedCount,
    remainingCount,
    focusCountry,
    resetView,
    setMissingMarkersVisible,
    update,
    destroy: () => {
      destroyed = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (focusAnimationFrame !== null) window.cancelAnimationFrame(focusAnimationFrame);
      resizeObserver?.disconnect();
    },
  };
}

export function setGlobeMapMissingMarkersVisible(view: GlobeMapView, visible: boolean): void {
  view.setMissingMarkersVisible(visible);
}

export function updateGlobeMapView(view: GlobeMapView, guessedCountryIds: ReadonlySet<CountryId>, totalCountries: number): void {
  view.update(guessedCountryIds, totalCountries);
}
