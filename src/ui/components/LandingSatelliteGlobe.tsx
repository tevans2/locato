import { useEffect, useRef } from "react";
import * as THREE from "three";
import { loadWorldCountryFeatures, type WorldCountryFeature, type WorldMapPolygon, type WorldMapPosition } from "../../core/map";
import { currentTheme, LOCATO_THEME_EVENT } from "../theme";

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;
const GLOBE_RADIUS = 2;

function textureX(longitude: number): number {
  return ((longitude + 180) / 360) * TEXTURE_WIDTH;
}

function textureY(latitude: number): number {
  return ((90 - latitude) / 180) * TEXTURE_HEIGHT;
}

function drawRing(context: CanvasRenderingContext2D, ring: readonly WorldMapPosition[], offset: number): void {
  if (ring.length === 0) return;
  let previousLongitude = ring[0]![0];
  context.moveTo(textureX(previousLongitude) + offset, textureY(ring[0]![1]));

  for (let index = 1; index < ring.length; index += 1) {
    let [longitude, latitude] = ring[index]!;
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (previousLongitude - longitude > 180) longitude += 360;
    context.lineTo(textureX(longitude) + offset, textureY(latitude));
    previousLongitude = longitude;
  }
  context.closePath();
}

function addPolygonPath(context: CanvasRenderingContext2D, polygon: WorldMapPolygon): void {
  for (const offset of [-TEXTURE_WIDTH, 0, TEXTURE_WIDTH]) {
    for (const ring of polygon) drawRing(context, ring, offset);
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createEarthTexture(features: readonly WorldCountryFeature[], dark: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create landing globe texture.");

  const ocean = context.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
  ocean.addColorStop(0, dark ? "#163c3c" : "#d5e8e6");
  ocean.addColorStop(0.42, dark ? "#0f302f" : "#bfdcd9");
  ocean.addColorStop(0.72, dark ? "#0a2526" : "#b1d1cf");
  ocean.addColorStop(1, dark ? "#173b39" : "#cce2df");
  context.fillStyle = ocean;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  const oceanGlow = context.createRadialGradient(TEXTURE_WIDTH * 0.32, TEXTURE_HEIGHT * 0.3, 20, TEXTURE_WIDTH * 0.32, TEXTURE_HEIGHT * 0.3, TEXTURE_WIDTH * 0.65);
  oceanGlow.addColorStop(0, dark ? "rgba(114, 207, 190, 0.16)" : "rgba(255, 255, 255, 0.24)");
  oceanGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = oceanGlow;
  context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  const land = context.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
  land.addColorStop(0, dark ? "#b7c88f" : "#f4f1e5");
  land.addColorStop(0.2, dark ? "#8eab72" : "#e4e8d4");
  land.addColorStop(0.48, dark ? "#698f5b" : "#cad9b8");
  land.addColorStop(0.72, dark ? "#86a56d" : "#dce4cb");
  land.addColorStop(1, dark ? "#b7c88f" : "#f4f1e5");
  context.fillStyle = land;
  context.beginPath();
  for (const feature of features) {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) addPolygonPath(context, polygon);
  }
  context.fill("evenodd");

  context.strokeStyle = dark ? "rgba(11, 25, 20, 0.72)" : "rgba(62, 84, 75, 0.72)";
  context.lineWidth = 1.15;
  for (const feature of features) {
    context.beginPath();
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) addPolygonPath(context, polygon);
    context.stroke();
  }

  context.globalCompositeOperation = "soft-light";
  const random = seededRandom(0x10ca70);
  for (let index = 0; index < 1800; index += 1) {
    const x = random() * TEXTURE_WIDTH;
    const y = random() * TEXTURE_HEIGHT;
    const radius = 0.4 + random() * 2.2;
    context.fillStyle = random() > 0.46 ? `rgba(255,255,245,${0.012 + random() * 0.03})` : `rgba(44,73,62,${0.01 + random() * 0.03})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create landing globe clouds.");

  const random = seededRandom(0xc10d5);
  context.filter = "blur(9px)";
  for (let index = 0; index < 170; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const width = 18 + random() * 96;
    const height = 4 + random() * 17;
    context.fillStyle = `rgba(244,249,239,${0.035 + random() * 0.1})`;
    context.beginPath();
    context.ellipse(x, y, width, height, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.filter = "none";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function LandingSatelliteGlobe() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const controller = new AbortController();
    let renderer: THREE.WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let handleVisibilityChange: (() => void) | null = null;
    let frameId: number | null = null;
    let earthTexture: THREE.CanvasTexture | null = null;
    let cloudTexture: THREE.CanvasTexture | null = null;
    let earthGeometry: THREE.SphereGeometry | null = null;
    let cloudGeometry: THREE.SphereGeometry | null = null;
    let atmosphereGeometry: THREE.SphereGeometry | null = null;
    let earthMaterial: THREE.MeshStandardMaterial | null = null;
    let cloudMaterial: THREE.MeshPhongMaterial | null = null;
    let atmosphereMaterial: THREE.MeshBasicMaterial | null = null;

    void loadWorldCountryFeatures((input, init) => fetch(input, { ...init, signal: controller.signal }))
      .then((features) => {
        if (controller.signal.aborted) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        // Leave clear canvas space around the atmosphere so the sphere never
        // develops a flat clipped edge on short or high-DPI viewports.
        camera.position.set(0, 0.06, 6.5);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth <= 700 ? 1 : 1.25));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.className = "landing-satellite-canvas";
        container.append(renderer.domElement);

        earthTexture = createEarthTexture(features, currentTheme() === "dark");
        cloudTexture = createCloudTexture();
        const globe = new THREE.Group();
        globe.rotation.set(-0.12, -0.65, -0.1);
        scene.add(globe);

        earthGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 56);
        earthMaterial = new THREE.MeshStandardMaterial({
          map: earthTexture,
          color: 0xffffff,
          roughness: 0.9,
          metalness: 0.02,
          emissive: 0x1c2c25,
          emissiveIntensity: 0.04,
        });
        const earth = new THREE.Mesh(earthGeometry, earthMaterial);
        globe.add(earth);

        cloudGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.025, 80, 48);
        cloudMaterial = new THREE.MeshPhongMaterial({
          map: cloudTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
        globe.add(clouds);

        atmosphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS + 0.09, 80, 48);
        atmosphereMaterial = new THREE.MeshBasicMaterial({
          color: currentTheme() === "dark" ? 0x65c8b6 : 0x8bd23f,
          transparent: true,
          opacity: 0.045,
          side: THREE.BackSide,
          depthWrite: false,
        });
        globe.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

        scene.add(new THREE.HemisphereLight(0xffffff, 0x617169, 1.7));
        const sunlight = new THREE.DirectionalLight(0xffffff, 3.1);
        sunlight.position.set(-2.4, 3.1, 4.8);
        scene.add(sunlight);
        const rimLight = new THREE.DirectionalLight(0x8bd23f, 0.65);
        rimLight.position.set(4.2, -0.5, -2.6);
        scene.add(rimLight);

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const frameInterval = 1000 / 30;
        let isVisible = true;
        let lastRenderTime = performance.now();

        const updateTheme = () => {
          if (!earthMaterial || !atmosphereMaterial || !renderer) return;
          const replacement = createEarthTexture(features, currentTheme() === "dark");
          const previous = earthTexture;
          earthTexture = replacement;
          earthMaterial.map = replacement;
          earthMaterial.needsUpdate = true;
          atmosphereMaterial.color.set(currentTheme() === "dark" ? 0x65c8b6 : 0x8bd23f);
          renderer.render(scene, camera);
          previous?.dispose();
        };

        const resize = () => {
          if (!renderer) return;
          const rect = container.getBoundingClientRect();
          const width = Math.max(1, Math.floor(rect.width));
          const height = Math.max(1, Math.floor(rect.height));
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
        };

        const stopRendering = () => {
          if (frameId !== null) window.cancelAnimationFrame(frameId);
          frameId = null;
        };

        const requestRender = () => {
          if (frameId === null && !reducedMotion && isVisible && !document.hidden) {
            frameId = window.requestAnimationFrame(renderFrame);
          }
        };

        const renderFrame = (timestamp: number) => {
          frameId = null;
          if (!renderer || reducedMotion || !isVisible || document.hidden) return;

          const elapsed = timestamp - lastRenderTime;
          if (elapsed >= frameInterval) {
            const deltaSeconds = Math.min(elapsed, 100) / 1000;
            earth.rotation.y += 0.0432 * deltaSeconds;
            clouds.rotation.y += 0.0558 * deltaSeconds;
            renderer.render(scene, camera);
            lastRenderTime = timestamp;
          }

          requestRender();
        };

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);

        if (typeof IntersectionObserver !== "undefined") {
          intersectionObserver = new IntersectionObserver(([entry]) => {
            isVisible = entry?.isIntersecting ?? true;
            lastRenderTime = performance.now();
            if (isVisible) requestRender();
            else stopRendering();
          }, { threshold: 0.01 });
          intersectionObserver.observe(container);
        }

        handleVisibilityChange = () => {
          lastRenderTime = performance.now();
          if (document.hidden) stopRendering();
          else requestRender();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener(LOCATO_THEME_EVENT, updateTheme, { signal: controller.signal });

        resize();
        requestRender();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn("Unable to render landing globe.", error);
      });

    return () => {
      controller.abort();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (handleVisibilityChange) document.removeEventListener("visibilitychange", handleVisibilityChange);
      renderer?.domElement.remove();
      renderer?.dispose();
      earthTexture?.dispose();
      cloudTexture?.dispose();
      earthGeometry?.dispose();
      cloudGeometry?.dispose();
      atmosphereGeometry?.dispose();
      earthMaterial?.dispose();
      cloudMaterial?.dispose();
      atmosphereMaterial?.dispose();
    };
  }, []);

  return <div ref={containerRef} className="landing-satellite-globe" />;
}
