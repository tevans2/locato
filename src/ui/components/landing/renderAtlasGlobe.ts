import * as THREE from "three";
import type { Country, CountryIndex } from "../../../core/countries";
import type { WorldCountryFeature, WorldMapPolygon, WorldMapPosition } from "../../../core/map";
import { currentTheme, LOCATO_THEME_EVENT } from "../../theme";
import { atlasCountryAnchor, atlasPolygons, atlasPosition, atlasTexturePoint, unwrapAtlasRing } from "./atlasGeometry";

const TEXTURE_WIDTH = 4096;
const TEXTURE_HEIGHT = 2048;
const PICK_WIDTH = 2048;
const PICK_HEIGHT = 1024;
const INITIAL_PITCH = 0.14;
const INITIAL_YAW = -0.32;

export interface AtlasHover {
  readonly country: Country;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface AtlasGlobe {
  readonly reset: () => void;
  readonly selectCountry: (code: string) => void;
  readonly destroy: () => void;
}

interface AtlasOptions {
  readonly countryIndex: CountryIndex;
  readonly onHover: (hover: AtlasHover | null) => void;
  readonly onOpenCountry: (code: string) => void;
}

function canvasContext(width: number, height: number, picking = false): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: picking });
  if (!context) throw new Error("The globe needs canvas support.");
  return context;
}

function tracePolygon(context: CanvasRenderingContext2D, polygon: WorldMapPolygon, offset: number): void {
  const { width, height } = context.canvas;
  context.beginPath();
  for (const ring of polygon) {
    const points = unwrapAtlasRing(ring);
    points.forEach((point, index) => {
      const [x, y] = atlasTexturePoint(point, width, height);
      if (index === 0) context.moveTo(x + offset, y);
      else context.lineTo(x + offset, y);
    });
    context.closePath();
  }
}

function paintFeature(context: CanvasRenderingContext2D, feature: WorldCountryFeature, fill: string, stroke?: string): void {
  context.fillStyle = fill;
  if (stroke) context.strokeStyle = stroke;
  for (const polygon of atlasPolygons(feature)) {
    for (const offset of [-context.canvas.width, 0, context.canvas.width]) {
      tracePolygon(context, polygon, offset);
      context.fill("evenodd");
      if (stroke) context.stroke();
    }
  }
}

/** An independent atlas view: game maps retain their gameplay palette and behaviour. */
export function createAtlasGlobe(host: HTMLElement, features: readonly WorldCountryFeature[], options: AtlasOptions): AtlasGlobe {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "atlas-globe-canvas";
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "group");
  renderer.domElement.setAttribute("aria-label", "Interactive globe. Drag to rotate. Use arrow keys to rotate, Home to reset, and Enter to explore the selected country.");
  host.append(renderer.domElement);

  const base = canvasContext(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  const highlight = canvasContext(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  const picking = canvasContext(PICK_WIDTH, PICK_HEIGHT, true);
  const countryByPixel = new Map<number, Country>();
  const featureByCode = new Map(features.map((feature) => [feature.code.toUpperCase(), feature]));
  features.forEach((feature, index) => {
    const country = options.countryIndex.byCode.get(feature.code.toUpperCase());
    if (!country) return;
    // Widely separated colours prevent antialiased border pixels selecting an unrelated country.
    const pixelId = ((index + 1) * 15485863) & 0xffffff;
    countryByPixel.set(pixelId, country);
    paintFeature(picking, feature, `#${pixelId.toString(16).padStart(6, "0")}`);
  });
  const pickPixels = picking.getImageData(0, 0, PICK_WIDTH, PICK_HEIGHT).data;
  picking.canvas.width = picking.canvas.height = 1;

  function paintBase(): void {
    const dark = currentTheme() === "dark";
    const ocean = base.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
    ocean.addColorStop(0, dark ? "#678176" : "#c4d1bc");
    ocean.addColorStop(0.5, dark ? "#425f54" : "#adbeaa");
    ocean.addColorStop(1, dark ? "#344f43" : "#9caf9c");
    base.fillStyle = ocean;
    base.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    base.lineWidth = 2.1;
    base.lineJoin = "round";
    for (const feature of features) paintFeature(base, feature, dark ? "#d8ddc7" : "#f5f2e3", dark ? "#567568" : "#5e7866");
    base.strokeStyle = dark ? "#f3f1dc25" : "#fffef03c";
    base.lineWidth = 1.4;
    base.beginPath();
    for (let longitude = -180; longitude < 180; longitude += 20) {
      const [x] = atlasTexturePoint([longitude, 0], TEXTURE_WIDTH, TEXTURE_HEIGHT);
      for (const offset of [-TEXTURE_WIDTH, 0, TEXTURE_WIDTH]) {
        base.moveTo(x + offset, 0);
        base.lineTo(x + offset, TEXTURE_HEIGHT);
      }
    }
    for (let latitude = -80; latitude <= 80; latitude += 20) {
      const [, y] = atlasTexturePoint([0, latitude], TEXTURE_WIDTH, TEXTURE_HEIGHT);
      base.moveTo(0, y);
      base.lineTo(TEXTURE_WIDTH, y);
    }
    base.stroke();
  }
  paintBase();
  const baseTexture = new THREE.CanvasTexture(base.canvas);
  const highlightTexture = new THREE.CanvasTexture(highlight.canvas);
  for (const texture of [baseTexture, highlightTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.16, 1.16, 1.16, -1.16, 0.1, 10);
  camera.position.set(0, 0, 4);
  const root = new THREE.Group();
  root.rotation.set(INITIAL_PITCH, INITIAL_YAW, 0);
  scene.add(root);
  const geometry = new THREE.SphereGeometry(1, 160, 96);
  const material = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: baseTexture }, selection: { value: highlightTexture } },
    vertexShader: `
      varying vec2 atlasUv;
      varying vec3 globeNormal;
      void main() {
        atlasUv = uv;
        globeNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D atlas;
      uniform sampler2D selection;
      varying vec2 atlasUv;
      varying vec3 globeNormal;
      void main() {
        vec3 normal = normalize(globeNormal);
        vec4 selected = texture2D(selection, atlasUv);
        vec3 colour = mix(texture2D(atlas, atlasUv).rgb, selected.rgb, selected.a);
        float daylight = max(dot(normal, normalize(vec3(-0.5, 0.85, 1.6))), 0.0);
        float shade = 0.57 + 0.40 * daylight + 0.03 * max(normal.z, 0.0);
        gl_FragColor = vec4(colour * shade, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const globe = new THREE.Mesh(geometry, material);
  root.add(globe);
  const markerGeometry = new THREE.SphereGeometry(0.013, 16, 12);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xfffef2 });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  root.add(marker);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const worldAnchor = new THREE.Vector3();
  const localAnchor = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const events = new AbortController();
  const listenerOptions = { signal: events.signal };
  let selected: Country | null = null;
  let frame: number | null = null;
  let destroyed = false;
  let dragging = false;
  let activePointer: number | null = null;
  let startX = 0, startY = 0;
  let startPitch = INITIAL_PITCH, startYaw = INITIAL_YAW;

  function publishHover(): void {
    if (!selected) { options.onHover(null); return; }
    worldAnchor.copy(localAnchor).applyMatrix4(root.matrixWorld);
    const visible = worldAnchor.z > 0.06;
    projected.copy(worldAnchor).project(camera);
    options.onHover({ country: selected, x: (projected.x + 1) / 2 * host.clientWidth, y: (1 - projected.y) / 2 * host.clientHeight, visible });
    marker.visible = visible;
  }

  function requestRender(): void {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (destroyed || document.hidden || !host.clientWidth) return;
      root.updateMatrixWorld(true);
      publishHover();
      renderer.render(scene, camera);
    });
  }

  function select(country: Country | null, position?: THREE.Vector3): void {
    if (country?.code === selected?.code) return;
    selected = country;
    highlight.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    const feature = country ? featureByCode.get(country.code) : undefined;
    if (feature) {
      highlight.lineWidth = 2.5;
      paintFeature(highlight, feature, "#315c41", "#264b35");
      localAnchor.copy(position ?? new THREE.Vector3(...atlasPosition(atlasCountryAnchor(feature)))).normalize();
      marker.position.copy(localAnchor).multiplyScalar(1.007);
    }
    marker.visible = Boolean(feature);
    highlightTexture.needsUpdate = true;
    renderer.domElement.style.cursor = dragging ? "grabbing" : country ? "pointer" : "grab";
    requestRender();
  }

  function countryAt(event: PointerEvent): { country: Country; position: THREE.Vector3 } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    root.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(globe)[0];
    if (!hit?.uv) return null;
    const x = Math.min(PICK_WIDTH - 1, Math.max(0, Math.floor(hit.uv.x * PICK_WIDTH)));
    const y = Math.min(PICK_HEIGHT - 1, Math.max(0, Math.floor((1 - hit.uv.y) * PICK_HEIGHT)));
    const offset = (y * PICK_WIDTH + x) * 4;
    if (pickPixels[offset + 3] !== 255) return null;
    const pixelId = (pickPixels[offset]! << 16) | (pickPixels[offset + 1]! << 8) | pickPixels[offset + 2]!;
    const country = countryByPixel.get(pixelId);
    if (!country) return null;
    inverse.copy(root.matrixWorld).invert();
    return { country, position: hit.point.clone().applyMatrix4(inverse) };
  }

  function resize(): void {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = 1.11 / Math.min(1, aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activePointer !== null) return;
    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startPitch = root.rotation.x;
    startYaw = root.rotation.y;
    renderer.domElement.setPointerCapture(event.pointerId);
  }, listenerOptions);
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (activePointer !== null && activePointer !== event.pointerId) return;
    if (activePointer !== null) {
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!dragging && distance < 5) return;
      if (!dragging) { dragging = true; select(null); }
      const scale = 2.8 / Math.max(1, host.clientWidth);
      root.rotation.y = startYaw + (event.clientX - startX) * scale;
      root.rotation.x = THREE.MathUtils.clamp(startPitch + (event.clientY - startY) * scale, -1.35, 1.35);
      renderer.domElement.style.cursor = "grabbing";
      requestRender();
      return;
    }
    if (event.pointerType === "touch") return;
    const hit = countryAt(event);
    select(hit?.country ?? null, hit?.position);
  }, listenerOptions);

  function finishPointer(event: PointerEvent): void {
    if (event.pointerId !== activePointer) return;
    const wasDragging = dragging;
    dragging = false;
    activePointer = null;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    renderer.domElement.style.cursor = "grab";
    if (event.type === "pointercancel" || wasDragging) return;
    const hit = countryAt(event);
    if (!hit) { select(null); return; }
    select(hit.country, hit.position);
    // On touch, the first tap reveals the same card a mouse hover would reveal.
    if (event.pointerType !== "touch") options.onOpenCountry(hit.country.code);
  }
  renderer.domElement.addEventListener("pointerup", finishPointer, listenerOptions);
  renderer.domElement.addEventListener("pointercancel", finishPointer, listenerOptions);
  renderer.domElement.addEventListener("lostpointercapture", () => {
    dragging = false;
    activePointer = null;
    renderer.domElement.style.cursor = "grab";
  }, listenerOptions);

  function reset(): void {
    root.rotation.set(INITIAL_PITCH, INITIAL_YAW, 0);
    select(null);
    select(options.countryIndex.byCode.get("ZA") ?? null);
    requestRender();
  }
  function selectCountry(code: string): void {
    const feature = featureByCode.get(code), country = options.countryIndex.byCode.get(code);
    if (!feature || !country) return;
    const [longitude, latitude] = atlasCountryAnchor(feature);
    root.rotation.set(latitude * Math.PI / 180, -longitude * Math.PI / 180, 0);
    select(null);
    select(country);
    requestRender();
  }
  renderer.domElement.addEventListener("keydown", (event) => {
    const steps: Record<string, readonly [number, number]> = { ArrowLeft: [0, -0.15], ArrowRight: [0, 0.15], ArrowUp: [-0.15, 0], ArrowDown: [0.15, 0] };
    if (steps[event.key]) {
      event.preventDefault();
      root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + steps[event.key]![0], -1.35, 1.35);
      root.rotation.y += steps[event.key]![1];
      requestRender();
    } else if (event.key === "Home") { event.preventDefault(); reset(); }
    else if (event.key === "Escape") select(null);
    else if (event.key === "Enter" && selected) { event.preventDefault(); options.onOpenCountry(selected.code); }
  }, listenerOptions);
  window.addEventListener(LOCATO_THEME_EVENT, () => {
    paintBase();
    baseTexture.needsUpdate = true;
    requestRender();
  }, listenerOptions);
  document.addEventListener("visibilitychange", requestRender, listenerOptions);
  renderer.domElement.addEventListener("webglcontextlost", (event) => event.preventDefault(), listenerOptions);
  renderer.domElement.addEventListener("webglcontextrestored", requestRender, listenerOptions);
  resize();
  reset();

  return {
    reset,
    selectCountry,
    destroy: () => {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      events.abort();
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      baseTexture.dispose();
      highlightTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      base.canvas.width = base.canvas.height = 1;
      highlight.canvas.width = highlight.canvas.height = 1;
    },
  };
}
