import * as THREE from "three";
import type { CountryId, CountryIndex } from "../../core/countries";
import type { WorldCountryFeature, WorldMapPolygon, WorldMapPosition } from "../../core/map";

const GLOBE_RADIUS = 2;
const MARKER_RADIUS = 0.026;
const ROTATION_SPEED = 0.0018;
const COLOR_BASE = 0x2f3a2e;
const COLOR_LINE = 0x7d8477;
const COLOR_GUESSED = 0xb8e36d;
const COLOR_MISSED = 0xed4a43;
const COLOR_TARGET = 0xffd0c2;

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
}

interface GlobeCountryObject {
  readonly countryId: CountryId;
  readonly lineMaterial: THREE.LineBasicMaterial;
  readonly markerMaterial: THREE.MeshBasicMaterial;
  readonly marker: THREE.Mesh;
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

function ringToPoints(ring: readonly WorldMapPosition[], radius = GLOBE_RADIUS + 0.012): THREE.Vector3[] {
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
  if (state.missedCountryIds.has(countryId)) return COLOR_MISSED;
  if (state.targetCountryId === countryId) return COLOR_TARGET;
  if (state.guessedCountryIds.has(countryId)) return COLOR_GUESSED;
  return COLOR_LINE;
}

export function createGlobeMapView(features: readonly WorldCountryFeature[], countryIndex: CountryIndex, options: GlobeMapViewOptions = {}): GlobeMapView {
  const element = document.createElement("div");
  element.className = "world-globe-panel";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "Interactive 3D globe. Drag to rotate and click countries to identify them.");

  const label = document.createElement("div");
  label.className = "world-map-country-label";
  label.hidden = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = "world-globe-canvas";
  element.append(renderer.domElement, label);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.12, 5.4);

  const root = new THREE.Group();
  root.rotation.y = -0.35;
  scene.add(root);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 72, 36),
    new THREE.MeshPhongMaterial({
      color: COLOR_BASE,
      emissive: 0x111811,
      shininess: 18,
      transparent: true,
      opacity: 0.96,
    }),
  );
  root.add(globe);

  scene.add(new THREE.AmbientLight(0xe8e2d3, 1.4));
  const light = new THREE.DirectionalLight(0xb8e36d, 1.9);
  light.position.set(2, 2.6, 4);
  scene.add(light);

  const countryObjects: GlobeCountryObject[] = [];
  const pickables: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.035 };
  const pointer = new THREE.Vector2();
  let frameId: number | null = null;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let clickableCountryIds: ReadonlySet<CountryId> | null = null;
  const projectedMarkerPosition = new THREE.Vector3();

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    if (!country) continue;

    const lineMaterial = new THREE.LineBasicMaterial({ color: COLOR_LINE, transparent: true, opacity: 0.58 });
    const markerMaterial = new THREE.MeshBasicMaterial({ color: COLOR_LINE, transparent: true, opacity: 0.2 });
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

    countryObjects.push({ countryId: country.id, lineMaterial, markerMaterial, marker });
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
    if (!dragging) root.rotation.y += ROTATION_SPEED;
    renderer.render(scene, camera);
  }

  function countryIdFromPointer(event: PointerEvent): CountryId | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
    const countryId = Number(hit?.userData.countryId);
    if (Number.isInteger(countryId)) return countryId;

    let nearestCountryId: CountryId | null = null;
    let nearestDistance = 38;
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

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    if (deltaX * deltaX + deltaY * deltaY > 9) moved = true;
    root.rotation.y += deltaX * 0.008;
    root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + deltaY * 0.006, -0.95, 0.95);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  function finishPointer(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (moved) return;

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
    for (const countryObject of countryObjects) {
      const color = colorForCountry(state, countryObject.countryId);
      const clickable = clickableCountryIds === null || clickableCountryIds.has(countryObject.countryId);
      countryObject.lineMaterial.color.setHex(color);
      countryObject.lineMaterial.opacity = state.missedCountryIds.has(countryObject.countryId) || state.guessedCountryIds.has(countryObject.countryId) || state.targetCountryId === countryObject.countryId ? 0.96 : 0.46;
      countryObject.markerMaterial.color.setHex(color);
      countryObject.markerMaterial.opacity = clickable ? 0.86 : 0.16;
      countryObject.marker.scale.setScalar(state.missedCountryIds.has(countryObject.countryId) || state.targetCountryId === countryObject.countryId ? 1.85 : 1);
    }
  }

  return {
    element,
    showCountryLabel,
    resetView: () => {
      root.rotation.set(0, -0.35, 0);
    },
    destroy: () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      for (const object of countryObjects) {
        object.lineMaterial.dispose();
        object.marker.geometry.dispose();
        object.markerMaterial.dispose();
      }
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
    },
    update,
  };
}
