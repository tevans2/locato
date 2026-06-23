import * as THREE from "three";
import type { CountryId, CountryIndex } from "../../core/countries";
import type { WorldCountryFeature, WorldMapPolygon, WorldMapPosition } from "../../core/map";

const GLOBE_RADIUS = 2;
const MARKER_RADIUS = 0.012;
const COLOR_COUNTRY_LINE = 0xe8e2d3;
const COLOR_GUESSED_LINE = 0xf5f4ce;
const COLOR_MISSED_LINE = 0xffdcd1;
const COLOR_TARGET_LINE = 0xffebdb;
const COLOR_GUESSED_MARKER = 0xb8e36d;
const COLOR_MISSED_MARKER = 0xed4a43;
const COLOR_TARGET_MARKER = 0xed4a43;
const OPACITY_COUNTRY_LINE = 0.34;
const OPACITY_GUESSED_LINE = 0.9;
const OPACITY_MISSED_LINE = 0.9;
const OPACITY_TARGET_LINE = 0.96;
const TEXTURE_WIDTH = 8192;
const TEXTURE_HEIGHT = 4096;

const GLOBE_DEFAULT_CAMERA_Z = 5.05;
const GLOBE_MIN_CAMERA_Z = 2.34;
const GLOBE_MAX_CAMERA_Z = 7.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0017;
const WHEEL_DELTA_LINE_PIXELS = 40;
const WHEEL_DELTA_PAGE_PIXELS = 800;
const MAX_WHEEL_DELTA_PIXELS = 180;
const MIN_WHEEL_DELTA_PIXELS = 0.25;
const DEFAULT_MARKER_CAMERA_DISTANCE = GLOBE_DEFAULT_CAMERA_Z - GLOBE_RADIUS;
const MIN_MARKER_ZOOM_SCALE = 0.08;
const GLOBE_OUTLINE_RADIUS = GLOBE_RADIUS + 0.0022;
const DRAG_ROTATION_Y = 0.008;
const DRAG_ROTATION_X = 0.006;
const COLOR_COUNTRY_FILL = "rgba(232, 226, 211, 0.09)";
const COLOR_UNPLAYABLE_COUNTRY_FILL = "rgba(232, 226, 211, 0.04)";
const COLOR_GUESSED_FILL = "rgba(184, 227, 109, 0.74)";
const COLOR_TARGET_FILL = "rgba(237, 74, 67, 0.9)";
const COLOR_MISSED_FILL = "rgba(237, 74, 67, 0.72)";


interface GlobeTouchPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface GlobeMapViewOptions {
  readonly onCountryClick?: (countryId: CountryId) => void;
}

export interface GlobeMapView {
  readonly element: HTMLElement;
  readonly showCountryLabel: (countryId: CountryId | null) => void;
  readonly resetView: () => void;
  readonly destroy: () => void;
  readonly update: (state: GlobeMapState) => void;
}

export interface GlobeMapState {
  readonly guessedCountryIds: ReadonlySet<CountryId>;
  readonly missedCountryIds: ReadonlySet<CountryId>;
  readonly targetCountryId: CountryId | null;
  readonly clickableCountryIds: ReadonlySet<CountryId> | null;
  readonly showMissingCountryIds?: ReadonlySet<CountryId>;
}

interface GlobeCountryObject {
  readonly countryId: CountryId;
  readonly lineMaterial: THREE.LineBasicMaterial;
  readonly markerMaterial: THREE.MeshBasicMaterial;
  readonly marker: THREE.Mesh;
  markerScale: number;
}

function lonLatToVector([longitude, latitude]: WorldMapPosition, radius = GLOBE_RADIUS): THREE.Vector3 {
  const lon = THREE.MathUtils.degToRad(longitude);
  const lat = THREE.MathUtils.degToRad(latitude);
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.sin(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.cos(lon),
  );
}

function ringToPoints(ring: readonly WorldMapPosition[], radius = GLOBE_OUTLINE_RADIUS): THREE.Vector3[] {
  const points = ring.map((point) => lonLatToVector(point, radius));
  if (points.length > 1) points.push(points[0]!.clone());
  return points;
}

function largestPolygon(feature: WorldCountryFeature): WorldMapPolygon | null {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let selected: WorldMapPolygon | null = null;
  let selectedLength = -1;

  for (const polygon of polygons) {
    const outerRing = polygon[0];
    if (!outerRing) continue;
    if (outerRing.length > selectedLength) {
      selected = polygon;
      selectedLength = outerRing.length;
    }
  }

  return selected;
}

function countryCenter(feature: WorldCountryFeature): WorldMapPosition | null {
  const outerRing = largestPolygon(feature)?.[0];
  if (!outerRing || outerRing.length === 0) return null;

  let longitude = 0;
  let latitude = 0;
  for (const [lon, lat] of outerRing) {
    longitude += lon;
    latitude += lat;
  }

  return [longitude / outerRing.length, latitude / outerRing.length];
}

function colorForCountry(state: GlobeMapState, countryId: CountryId): number {
  if (state.missedCountryIds.has(countryId)) return COLOR_MISSED_LINE;
  if (state.targetCountryId === countryId) return COLOR_TARGET_LINE;
  if (state.guessedCountryIds.has(countryId)) return COLOR_GUESSED_LINE;
  return COLOR_COUNTRY_LINE;
}

function markerColorForCountry(state: GlobeMapState, countryId: CountryId): number {
  if (state.missedCountryIds.has(countryId)) return COLOR_MISSED_MARKER;
  if (state.targetCountryId === countryId) return COLOR_TARGET_MARKER;
  if (state.guessedCountryIds.has(countryId)) return COLOR_GUESSED_MARKER;
  return COLOR_COUNTRY_LINE;
}

function lineOpacityForCountry(state: GlobeMapState, countryId: CountryId): number {
  if (state.missedCountryIds.has(countryId)) return OPACITY_MISSED_LINE;
  if (state.targetCountryId === countryId) return OPACITY_TARGET_LINE;
  if (state.guessedCountryIds.has(countryId)) return OPACITY_GUESSED_LINE;
  return OPACITY_COUNTRY_LINE;
}

function fillStyleForCountry(playableCountryId: CountryId | null, state: GlobeMapState | null): string {
  if (playableCountryId === null) return COLOR_UNPLAYABLE_COUNTRY_FILL;
  if (!state) return COLOR_COUNTRY_FILL;
  if (state.missedCountryIds.has(playableCountryId)) return COLOR_MISSED_FILL;
  if (state.targetCountryId === playableCountryId) return COLOR_TARGET_FILL;
  if (state.guessedCountryIds.has(playableCountryId)) return COLOR_GUESSED_FILL;
  return COLOR_COUNTRY_FILL;
}

function longitudeToTextureX(longitude: number, width: number): number {
  return ((longitude + 90) / 360) * width;
}

function latitudeToTextureY(latitude: number, height: number): number {
  return ((90 - latitude) / 180) * height;
}

function drawTextureRing(context: CanvasRenderingContext2D, ring: readonly WorldMapPosition[], xOffset: number): void {
  if (ring.length === 0) return;
  const { width, height } = context.canvas;
  let previousLongitude = ring[0]![0];
  context.moveTo(longitudeToTextureX(previousLongitude, width) + xOffset, latitudeToTextureY(ring[0]![1], height));

  for (let index = 1; index < ring.length; index += 1) {
    const [, latitude] = ring[index]!;
    let longitude = ring[index]![0];
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (previousLongitude - longitude > 180) longitude += 360;
    context.lineTo(longitudeToTextureX(longitude, width) + xOffset, latitudeToTextureY(latitude, height));
    previousLongitude = longitude;
  }

  context.closePath();
}

function fillTexturePolygon(context: CanvasRenderingContext2D, polygon: WorldMapPolygon, fillStyle: string): void {
  const { width } = context.canvas;
  const offsets = [-width, 0, width];
  context.fillStyle = fillStyle;

  for (const offset of offsets) {
    context.beginPath();
    for (const ring of polygon) drawTextureRing(context, ring, offset);
    context.fill("evenodd");
  }
}

function paintGlobeTexture(context: CanvasRenderingContext2D, features: readonly WorldCountryFeature[], countryIndex: CountryIndex, state: GlobeMapState | null): void {
  const { width, height } = context.canvas;
  const oceanGradient = context.createLinearGradient(0, 0, 0, height);
  oceanGradient.addColorStop(0, "#121a10");
  oceanGradient.addColorStop(0.5, "#0b100b");
  oceanGradient.addColorStop(1, "#11180f");
  context.clearRect(0, 0, width, height);
  context.fillStyle = oceanGradient;
  context.fillRect(0, 0, width, height);

  for (const feature of features) {
    const playableCountryId = countryIndex.byCode.get(feature.code.toUpperCase())?.id ?? null;
    const fillStyle = fillStyleForCountry(playableCountryId, state);
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) fillTexturePolygon(context, polygon, fillStyle);
  }
}

function createGlobeTexture(renderer: THREE.WebGLRenderer, features: readonly WorldCountryFeature[], countryIndex: CountryIndex): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create globe texture canvas.");

  paintGlobeTexture(context, features, countryIndex, null);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function repaintGlobeTexture(texture: THREE.CanvasTexture, features: readonly WorldCountryFeature[], countryIndex: CountryIndex, state: GlobeMapState): void {
  const canvas = texture.image as HTMLCanvasElement;
  const context = canvas.getContext("2d");
  if (!context) return;
  paintGlobeTexture(context, features, countryIndex, state);
  texture.needsUpdate = true;
}

function normalizedWheelDeltaPixels(event: WheelEvent): number {
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_DELTA_LINE_PIXELS : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_DELTA_PAGE_PIXELS : 1;
  return THREE.MathUtils.clamp(event.deltaY * unit, -MAX_WHEEL_DELTA_PIXELS, MAX_WHEEL_DELTA_PIXELS);
}

function zoomFactorFromWheelDelta(deltaPixels: number): number | null {
  if (Math.abs(deltaPixels) < MIN_WHEEL_DELTA_PIXELS) return null;
  return Math.exp(deltaPixels * WHEEL_ZOOM_SENSITIVITY);
}

export function createGlobeMapView(features: readonly WorldCountryFeature[], countryIndex: CountryIndex, options: GlobeMapViewOptions = {}): GlobeMapView {
  const element = document.createElement("div");
  element.className = "world-globe-panel";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Interactive 3D world map. Drag to rotate, then scroll or pinch to zoom.");

  const label = document.createElement("div");
  label.className = "world-map-country-label";
  label.hidden = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "world-globe-canvas";
  element.append(renderer.domElement, label);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.12, GLOBE_DEFAULT_CAMERA_Z);

  const root = new THREE.Group();
  root.rotation.y = -0.35;
  scene.add(root);

  const globeTexture = createGlobeTexture(renderer, features, countryIndex);
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 128, 64),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: globeTexture,
      roughness: 0.88,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  root.add(globe);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS + 0.026, 128, 64),
    new THREE.MeshBasicMaterial({
      color: 0xb8e36d,
      transparent: true,
      opacity: 0.045,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  root.add(atmosphere);

  scene.add(new THREE.AmbientLight(0xfff6e5, 1.55));
  const keyLight = new THREE.DirectionalLight(0xfff7dd, 1.9);
  keyLight.position.set(2.4, 2.8, 4.6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xb8e36d, 0.48);
  rimLight.position.set(-3.5, 1.4, -2.5);
  scene.add(rimLight);

  const countryObjects: GlobeCountryObject[] = [];
  const pickables: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.035 };
  const pointer = new THREE.Vector2();
  let frameId: number | null = null;
  const touchPointers = new Map<number, GlobeTouchPoint>();
  let pinchDistance: number | null = null;
  let pinchCameraZ = camera.position.z;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let clickableCountryIds: ReadonlySet<CountryId> | null = null;
  const projectedMarkerPosition = new THREE.Vector3();
  const markerScaleWorldPosition = new THREE.Vector3();

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    if (!country) continue;

    const lineMaterial = new THREE.LineBasicMaterial({ color: COLOR_COUNTRY_LINE, transparent: true, opacity: OPACITY_COUNTRY_LINE, depthWrite: false });
    const markerMaterial = new THREE.MeshBasicMaterial({ color: COLOR_COUNTRY_LINE, transparent: true, opacity: 0, depthWrite: false });
    const center = countryCenter(feature);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 10, 8), markerMaterial);
    marker.userData.countryId = country.id;
    if (center) marker.position.copy(lonLatToVector(center, GLOBE_RADIUS + 0.035));
    root.add(marker);
    pickables.push(marker);

    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      const outerRing = polygon[0];
      if (!outerRing || outerRing.length < 2) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringToPoints(outerRing)), lineMaterial);
      line.userData.countryId = country.id;
      root.add(line);
      pickables.push(line);
    }

    countryObjects.push({ countryId: country.id, lineMaterial, markerMaterial, marker, markerScale: 0.5 });
  }

  function resize(): void {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(element);

  function render(): void {
    frameId = window.requestAnimationFrame(render);
    applyMarkerDisplayScales();
    renderer.render(scene, camera);
  }

  function clampCameraZoom(cameraZ: number): number {
    return THREE.MathUtils.clamp(cameraZ, GLOBE_MIN_CAMERA_Z, GLOBE_MAX_CAMERA_Z);
  }

  function dragRotationScale(): number {
    return THREE.MathUtils.clamp(camera.position.z / GLOBE_DEFAULT_CAMERA_Z, 0.4, 1);
  }

  function markerZoomScale(marker: THREE.Mesh): number {
    marker.getWorldPosition(markerScaleWorldPosition);
    const distance = markerScaleWorldPosition.distanceTo(camera.position);
    return THREE.MathUtils.clamp(distance / DEFAULT_MARKER_CAMERA_DISTANCE, MIN_MARKER_ZOOM_SCALE, 1);
  }

  function applyMarkerDisplayScale(countryObject: GlobeCountryObject): void {
    countryObject.marker.scale.setScalar(countryObject.markerScale * markerZoomScale(countryObject.marker));
  }

  function applyMarkerDisplayScales(): void {
    for (const countryObject of countryObjects) applyMarkerDisplayScale(countryObject);
  }

  function countryIdFromPointer(event: PointerEvent | MouseEvent): CountryId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
    const countryId = Number(hit?.userData.countryId);
    if (Number.isInteger(countryId)) return countryId;

    let nearestCountryId: CountryId | null = null;
    let nearestDistance = 32;
    for (const countryObject of countryObjects) {
      countryObject.marker.getWorldPosition(projectedMarkerPosition);
      projectedMarkerPosition.project(camera);
      if (projectedMarkerPosition.z < -1 || projectedMarkerPosition.z > 1) continue;

      const markerX = rect.left + ((projectedMarkerPosition.x + 1) / 2) * rect.width;
      const markerY = rect.top + ((1 - projectedMarkerPosition.y) / 2) * rect.height;
      const distance = Math.hypot(event.clientX - markerX, event.clientY - markerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCountryId = countryObject.countryId;
      }
    }

    return nearestCountryId;
  }

  function globeTouchPoints(): readonly GlobeTouchPoint[] {
    return [...touchPointers.values()];
  }

  function globeTouchDistance(): number {
    const points = globeTouchPoints();
    if (points.length < 2) return 0;
    const [first, second] = points;
    return Math.hypot(second!.clientX - first!.clientX, second!.clientY - first!.clientY);
  }

  function updatePinchZoom(): void {
    if (pinchDistance === null) return;
    const currentDistance = Math.max(1, globeTouchDistance());
    camera.position.z = clampCameraZoom(pinchCameraZ * (pinchDistance / currentDistance));
  }

  renderer.domElement.addEventListener("wheel", (event) => {
    const factor = zoomFactorFromWheelDelta(normalizedWheelDeltaPixels(event));
    if (factor === null) return;
    event.preventDefault();
    camera.position.z = clampCameraZoom(camera.position.z * factor);
  }, { passive: false });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);

    if (event.pointerType === "touch") {
      touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touchPointers.size >= 2) {
        dragging = false;
        moved = true;
        pinchDistance = Math.max(1, globeTouchDistance());
        pinchCameraZ = camera.position.z;
        return;
      }
    }

    dragging = true;
    moved = false;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      if (!touchPointers.has(event.pointerId)) return;
      event.preventDefault();
      touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touchPointers.size >= 2) {
        moved = true;
        updatePinchZoom();
        return;
      }
    }

    if (!dragging) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    const rotationScale = dragRotationScale();
    if (deltaX * deltaX + deltaY * deltaY > 9) moved = true;
    root.rotation.y += deltaX * DRAG_ROTATION_Y * rotationScale;
    root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + deltaY * DRAG_ROTATION_X * rotationScale, -0.95, 0.95);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  function finishPointer(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      touchPointers.delete(event.pointerId);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);

      if (pinchDistance !== null) {
        pinchDistance = null;
        const remaining = [...touchPointers.values()][0];
        if (remaining) {
          dragging = true;
          moved = true;
          lastX = remaining.clientX;
          lastY = remaining.clientY;
          return;
        }
      }
    }

    if (!dragging) return;
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (moved || event.type === "pointercancel") return;

    const countryId = countryIdFromPointer(event);
    if (countryId === null || (clickableCountryIds && !clickableCountryIds.has(countryId))) return;
    options.onCountryClick?.(countryId);
  }

  renderer.domElement.addEventListener("pointerup", finishPointer);
  renderer.domElement.addEventListener("pointercancel", finishPointer);

  resize();
  render();

  function showCountryLabel(countryId: CountryId | null): void {
    const country = countryId === null ? null : countryIndex.byId[countryId] ?? null;
    label.hidden = country === null;
    label.textContent = country ? country.name : "";
  }

  function update(state: GlobeMapState): void {
    clickableCountryIds = state.clickableCountryIds;
    repaintGlobeTexture(globeTexture, features, countryIndex, state);
    for (const countryObject of countryObjects) {
      const isMissed = state.missedCountryIds.has(countryObject.countryId);
      const isTarget = state.targetCountryId === countryObject.countryId;
      const isGuessed = state.guessedCountryIds.has(countryObject.countryId);
      const isShownMissing = state.showMissingCountryIds?.has(countryObject.countryId) ?? false;
      const color = colorForCountry(state, countryObject.countryId);
      countryObject.lineMaterial.color.setHex(color);
      countryObject.lineMaterial.opacity = lineOpacityForCountry(state, countryObject.countryId);
      countryObject.markerMaterial.color.setHex(markerColorForCountry(state, countryObject.countryId));
      countryObject.markerMaterial.opacity = isMissed || isTarget ? 0.92 : isShownMissing ? 0.66 : 0;
      countryObject.markerScale = isMissed || isTarget ? 1.2 : isShownMissing ? 0.7 : 0.5;
      applyMarkerDisplayScale(countryObject);
    }
  }

  return {
    element,
    showCountryLabel,
    resetView: () => {
      root.rotation.set(0, -0.35, 0);
      camera.position.z = GLOBE_DEFAULT_CAMERA_Z;
    },
    destroy: () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      globeTexture.dispose();
      for (const object of countryObjects) {
        object.lineMaterial.dispose();
        object.marker.geometry.dispose();
        object.markerMaterial.dispose();
      }
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
    },
    update,
  };
}
