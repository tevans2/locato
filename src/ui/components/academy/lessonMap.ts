import type { CountryCode, CountryIndex } from "../../../core/countries";
import { MAP_VIEWBOX_HEIGHT, MAP_VIEWBOX_WIDTH, mainLandmassBounds, projectWorldMapPosition, type WorldCountryFeature, type WorldMapPolygon } from "../../../core/map";

/**
 * A small, themeable world map for Academy lessons. One instance is shared by every step of a
 * lesson and re-parented into each step, so the (heavy) path geometry is built only once.
 *
 * Unlike the game map it frames countries by their *main* landmass (France without French
 * Guiana, the US without Alaska), frames arbitrary regions, and gives tiny countries a visible
 * ring and a generous invisible hit area.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const ANIMATION_MS = 460;
/** Countries whose main landmass is smaller than this (viewBox units) get rings and hit areas. */
const SMALL_COUNTRY_SIZE = 7;
const RING_RADIUS_PX = 15;
const HIT_RADIUS_PX = 18;
const DOT_RADIUS_PX = 3.2;
const MIN_VIEW_WIDTH = 14;
const MAX_VIEW_WIDTH = MAP_VIEWBOX_WIDTH * 1.08;

export type MapTone = "target" | "good" | "picked";
export type MapMode = "static" | "interactive";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FrameRequest {
  readonly box: Box;
  readonly pad: number;
  readonly minWidth: number;
}

export interface LessonMap {
  readonly element: HTMLElement;
  readonly hasCountry: (code: CountryCode) => boolean;
  readonly setMode: (mode: MapMode) => void;
  readonly setTone: (code: CountryCode, tone: MapTone | null) => void;
  readonly clearTones: () => void;
  /** Zoom to one country with some surroundings for context. */
  readonly frameCountry: (code: CountryCode, options?: { readonly animate?: boolean; readonly pad?: number; readonly minWidth?: number }) => void;
  /** Zoom so every listed country is visible. */
  readonly frameCountries: (codes: readonly CountryCode[], options?: { readonly animate?: boolean; readonly pad?: number; readonly minWidth?: number }) => void;
  /** A dashed circle roughly (not exactly) centred on the country. */
  readonly showHint: (code: CountryCode, random: () => number) => void;
  readonly clearHint: () => void;
  readonly showLabel: (text: string | null, tone?: "neutral" | "warm") => void;
  /** Invisible hit circles for tiny countries so they can be clicked on a phone. */
  readonly setHitAreas: (codes: readonly CountryCode[], priority: CountryCode | null) => void;
  /** Pixels at the bottom covered by an overlay (the feedback tray); framing keeps targets above it. */
  readonly setInsetBottom: (px: number) => void;
  /** Re-apply the last framing (e.g. after the inset changed). */
  readonly reframe: (animate?: boolean) => void;
  onCountryClick: ((code: CountryCode) => void) | null;
  readonly destroy: () => void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function polygonsOf(feature: WorldCountryFeature): readonly WorldMapPolygon[] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

function pathFor(feature: WorldCountryFeature): string {
  let d = "";
  for (const polygon of polygonsOf(feature)) {
    for (const ring of polygon) {
      ring.forEach((point, index) => {
        const [x, y] = projectWorldMapPosition(point);
        d += `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      });
      d += "Z";
    }
  }
  return d;
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Bounds of the home landmass plus nearby islands; far-flung territories are ignored. */
export function mainLandBox(feature: WorldCountryFeature): Box | null {
  const rect = mainLandmassBounds(feature);
  return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createLessonMap(features: readonly WorldCountryFeature[], countryIndex: CountryIndex): LessonMap {
  const svg = svgEl("svg", {
    class: "lx-map-svg",
    role: "img",
    "aria-label": "World map",
    preserveAspectRatio: "xMidYMid meet",
  });
  const countryLayer = svgEl("g", { class: "lx-map-countries" });
  const hitLayer = svgEl("g", { class: "lx-map-hits" });
  const markLayer = svgEl("g", { class: "lx-map-marks", "aria-hidden": "true" });
  svg.append(countryLayer, hitLayer, markLayer);

  const paths = new Map<CountryCode, SVGPathElement>();
  const boxes = new Map<CountryCode, Box>();
  for (const feature of features) {
    const code = feature.code.toUpperCase();
    const known = countryIndex.byCode.has(code);
    const path = svgEl("path", { d: pathFor(feature), class: `lx-map-country${known ? "" : " is-inert"}` });
    if (known) {
      path.dataset.code = code;
      paths.set(code, path);
      const box = mainLandBox(feature);
      if (box) boxes.set(code, box);
    }
    countryLayer.append(path);
  }

  const label = document.createElement("p");
  label.className = "lx-map-label";
  label.hidden = true;

  const zoomIn = mapButton("+", "Zoom in");
  const zoomOut = mapButton("−", "Zoom out");
  const recenter = mapButton("", "Recentre map");
  recenter.classList.add("is-recenter");
  recenter.append(recenterIcon());
  const controls = document.createElement("div");
  controls.className = "lx-map-controls";
  controls.append(zoomIn, zoomOut, recenter);

  const element = document.createElement("div");
  element.className = "lx-map is-static";
  element.append(svg, label, controls);

  let view: ViewBox = { x: 0, y: 0, w: MAP_VIEWBOX_WIDTH, h: MAP_VIEWBOX_HEIGHT };
  let lastFrame: FrameRequest | null = null;
  let userMoved = false;
  let animation: number | null = null;
  let mode: MapMode = "static";
  const tones = new Map<CountryCode, MapTone>();
  let hintCircle: SVGCircleElement | null = null;
  let hitCodes: readonly CountryCode[] = [];
  let hitPriority: CountryCode | null = null;
  let insetBottom = 0;

  function aspect(): number {
    const width = element.clientWidth;
    const height = element.clientHeight;
    return width > 0 && height > 0 ? height / width : 0.5;
  }

  function pxToUnits(px: number): number {
    const width = element.clientWidth || 600;
    return (px * view.w) / width;
  }

  function clampView(next: ViewBox): ViewBox {
    const ratio = aspect();
    const w = Math.min(MAX_VIEW_WIDTH, Math.max(MIN_VIEW_WIDTH, next.w));
    const h = w * ratio;
    const cx = Math.min(MAP_VIEWBOX_WIDTH, Math.max(0, next.x + next.w / 2));
    const cy = Math.min(MAP_VIEWBOX_HEIGHT + h / 2, Math.max(-h / 4, next.y + next.h / 2));
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function apply(next: ViewBox): void {
    view = next;
    svg.setAttribute("viewBox", `${view.x.toFixed(3)} ${view.y.toFixed(3)} ${view.w.toFixed(3)} ${view.h.toFixed(3)}`);
    redrawMarks();
  }

  function moveTo(next: ViewBox, animate: boolean): void {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    const target = clampView(next);
    if (!animate || prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      apply(target);
      return;
    }
    const from = { ...view };
    const started = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - started) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      apply({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        w: from.w + (target.w - from.w) * eased,
        h: from.h + (target.h - from.h) * eased,
      });
      animation = t < 1 ? requestAnimationFrame(tick) : null;
    };
    animation = requestAnimationFrame(tick);
  }

  function viewForFrame(frame: FrameRequest): ViewBox {
    const ratio = aspect();
    const height = element.clientHeight;
    // Fit the box into the part of the map not hidden under an overlay.
    const visible = height > 0 && insetBottom > 0 ? Math.max(0.3, (height - insetBottom) / height) : 1;
    const visibleRatio = ratio * visible;
    const w = Math.max(frame.box.w * frame.pad, (frame.box.h * frame.pad) / visibleRatio, frame.minWidth);
    const h = w * ratio;
    const visibleH = h * visible;
    return { x: frame.box.x + frame.box.w / 2 - w / 2, y: frame.box.y + frame.box.h / 2 - visibleH / 2, w, h };
  }

  function frame(request: FrameRequest, animate: boolean): void {
    lastFrame = request;
    userMoved = false;
    moveTo(viewForFrame(request), animate);
  }

  function frameCountries(codes: readonly CountryCode[], options: { readonly animate?: boolean; readonly pad?: number; readonly minWidth?: number } = {}): void {
    const box = unionBoxes(codes.map((code) => boxes.get(code.toUpperCase())).filter((value): value is Box => value !== undefined));
    if (!box) return;
    frame({ box, pad: options.pad ?? 1.35, minWidth: options.minWidth ?? 60 }, options.animate ?? false);
  }

  function isSmall(code: CountryCode): boolean {
    const box = boxes.get(code);
    return !!box && Math.max(box.w, box.h) < SMALL_COUNTRY_SIZE;
  }

  function centerOf(code: CountryCode): [number, number] | null {
    const box = boxes.get(code);
    return box ? [box.x + box.w / 2, box.y + box.h / 2] : null;
  }

  function redrawMarks(): void {
    markLayer.replaceChildren();
    for (const [code, tone] of tones) {
      if (!isSmall(code)) continue;
      const center = centerOf(code);
      if (!center) continue;
      markLayer.append(
        svgEl("circle", {
          class: `lx-map-ring is-${tone}`,
          cx: center[0].toFixed(3),
          cy: center[1].toFixed(3),
          r: pxToUnits(RING_RADIUS_PX).toFixed(3),
          "vector-effect": "non-scaling-stroke",
        }),
      );
    }
    if (hintCircle) markLayer.append(hintCircle);
    const hitRadius = pxToUnits(HIT_RADIUS_PX);
    const dotRadius = pxToUnits(DOT_RADIUS_PX).toFixed(3);
    for (const circle of hitLayer.querySelectorAll<SVGCircleElement>("circle.lx-map-hit")) {
      circle.setAttribute("r", (circle.dataset.code === hitPriority ? hitRadius * 1.25 : hitRadius).toFixed(3));
    }
    for (const dot of hitLayer.querySelectorAll("circle.lx-map-dot")) dot.setAttribute("r", dotRadius);
  }

  function setHitAreas(codes: readonly CountryCode[], priority: CountryCode | null): void {
    hitCodes = codes.map((code) => code.toUpperCase()).filter(isSmall);
    hitPriority = priority?.toUpperCase() ?? null;
    hitLayer.replaceChildren();
    // The priority circle goes last so it wins where circles overlap.
    const ordered = [...hitCodes.filter((code) => code !== hitPriority), ...hitCodes.filter((code) => code === hitPriority)];
    // Visible dots so microstates and small islands can be found at all (not which is which).
    for (const code of hitCodes) {
      const center = centerOf(code);
      if (center) hitLayer.append(svgEl("circle", { class: "lx-map-dot", cx: center[0].toFixed(3), cy: center[1].toFixed(3), r: "1" }));
    }
    for (const code of ordered) {
      const center = centerOf(code);
      if (!center) continue;
      const circle = svgEl("circle", { class: "lx-map-hit", cx: center[0].toFixed(3), cy: center[1].toFixed(3), r: "1" });
      circle.dataset.code = code;
      hitLayer.append(circle);
    }
    redrawMarks();
  }

  // Pan, pinch and wheel zoom (interactive mode only).
  const pointers = new Map<number, { x: number; y: number }>();
  let pan: { x: number; y: number; view: ViewBox; moved: boolean } | null = null;
  let pinch: { distance: number; view: ViewBox; cx: number; cy: number } | null = null;
  let suppressClick = false;

  function clientToMap(clientX: number, clientY: number, base: ViewBox): [number, number] {
    const rect = svg.getBoundingClientRect();
    const rx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    const ry = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    return [base.x + rx * base.w, base.y + ry * base.h];
  }

  function zoomAround(base: ViewBox, factor: number, point: [number, number]): ViewBox {
    const w = Math.min(MAX_VIEW_WIDTH, Math.max(MIN_VIEW_WIDTH, base.w * factor));
    const scale = w / base.w;
    const h = base.h * scale;
    return { x: point[0] - (point[0] - base.x) * scale, y: point[1] - (point[1] - base.y) * scale, w, h };
  }

  svg.addEventListener("pointerdown", (event) => {
    if (mode !== "interactive" || event.button > 0) return;
    suppressClick = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      pan = { x: event.clientX, y: event.clientY, view: { ...view }, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), view: { ...view }, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      pan = null;
      suppressClick = true;
    }
  });

  svg.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      apply(clampView(zoomAround(pinch.view, pinch.distance / distance, clientToMap(pinch.cx, pinch.cy, pinch.view))));
      userMoved = true;
      return;
    }
    if (!pan) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 6) return;
    if (!pan.moved) {
      pan.moved = true;
      element.classList.add("is-panning");
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers can't be captured; panning still works while over the map.
      }
    }
    const rect = svg.getBoundingClientRect();
    const unitsPerPx = rect.width > 0 ? pan.view.w / rect.width : 1;
    apply(clampView({ ...pan.view, x: pan.view.x - dx * unitsPerPx, y: pan.view.y - dy * unitsPerPx }));
    userMoved = true;
  });

  const endPointer = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pan?.moved || pinch) suppressClick = true;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      pan = null;
      element.classList.remove("is-panning");
    }
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  svg.addEventListener("click", (event) => {
    if (mode !== "interactive") return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<SVGElement>("[data-code]") : null;
    const code = target?.dataset.code;
    if (code) map.onCountryClick?.(code);
  });

  svg.addEventListener(
    "wheel",
    (event) => {
      if (mode !== "interactive") return;
      event.preventDefault();
      const delta = Math.max(-140, Math.min(140, event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY));
      apply(clampView(zoomAround(view, Math.exp(delta * 0.0022), clientToMap(event.clientX, event.clientY, view))));
      userMoved = true;
    },
    { passive: false },
  );

  zoomIn.addEventListener("click", () => {
    moveTo(zoomAround(view, 0.7, [view.x + view.w / 2, view.y + view.h / 2]), true);
    userMoved = true;
  });
  zoomOut.addEventListener("click", () => {
    moveTo(zoomAround(view, 1.4, [view.x + view.w / 2, view.y + view.h / 2]), true);
    userMoved = true;
  });
  recenter.addEventListener("click", () => {
    if (lastFrame) frame(lastFrame, true);
  });

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (lastFrame && !userMoved) moveTo(viewForFrame(lastFrame), false);
          else apply(clampView(view));
        })
      : null;
  resizeObserver?.observe(element);

  apply(clampView(view));

  const map: LessonMap = {
    element,
    hasCountry: (code) => paths.has(code.toUpperCase()) && boxes.has(code.toUpperCase()),
    setMode: (next) => {
      mode = next;
      element.classList.toggle("is-static", next === "static");
      element.classList.toggle("is-interactive", next === "interactive");
      svg.setAttribute("aria-label", next === "interactive" ? "World map. Drag to move, scroll or pinch to zoom, click a country to answer." : "World map");
    },
    setTone: (code, tone) => {
      const upper = code.toUpperCase();
      const path = paths.get(upper);
      if (!path) return;
      path.classList.remove("is-target", "is-good", "is-picked");
      if (tone) {
        path.classList.add(`is-${tone}`);
        tones.set(upper, tone);
        // Keep highlighted outlines on top of their neighbours' strokes.
        countryLayer.append(path);
      } else tones.delete(upper);
      redrawMarks();
    },
    clearTones: () => {
      for (const code of tones.keys()) paths.get(code)?.classList.remove("is-target", "is-good", "is-picked");
      tones.clear();
      redrawMarks();
    },
    frameCountry: (code, options = {}) => {
      const box = boxes.get(code.toUpperCase());
      if (!box) return;
      frame({ box, pad: options.pad ?? 3.2, minWidth: options.minWidth ?? 70 }, options.animate ?? false);
    },
    frameCountries,
    showHint: (code, random) => {
      const upper = code.toUpperCase();
      const box = boxes.get(upper);
      const center = centerOf(upper);
      if (!box || !center) return;
      const radius = Math.max(Math.max(box.w, box.h) * 0.95, pxToUnits(46));
      const angle = random() * Math.PI * 2;
      const offset = radius * (0.2 + random() * 0.3);
      const hx = center[0] + Math.cos(angle) * offset;
      const hy = center[1] + Math.sin(angle) * offset;
      hintCircle = svgEl("circle", {
        class: "lx-map-hint",
        cx: hx.toFixed(3),
        cy: hy.toFixed(3),
        r: radius.toFixed(3),
        "vector-effect": "non-scaling-stroke",
      });
      redrawMarks();
      // Glide towards the circle when it's small on screen, so tiny countries become tappable.
      const pad = 2.8;
      if (radius * 2 * pad < view.w * 0.8) frame({ box: { x: hx - radius, y: hy - radius, w: radius * 2, h: radius * 2 }, pad, minWidth: 12 }, true);
    },
    clearHint: () => {
      hintCircle = null;
      redrawMarks();
    },
    showLabel: (text, tone = "neutral") => {
      label.hidden = !text;
      label.textContent = text ?? "";
      label.classList.toggle("is-warm", tone === "warm");
    },
    setHitAreas,
    setInsetBottom: (px) => {
      insetBottom = Math.max(0, px);
    },
    reframe: (animate = true) => {
      if (lastFrame) frame(lastFrame, animate);
    },
    onCountryClick: null,
    destroy: () => {
      if (animation !== null) cancelAnimationFrame(animation);
      resizeObserver?.disconnect();
      element.remove();
    },
  };
  return map;
}

function mapButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "lx-map-button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  return button;
}

function recenterIcon(): SVGSVGElement {
  const icon = svgEl("svg", { viewBox: "0 0 20 20", width: "16", height: "16", "aria-hidden": "true" });
  icon.append(
    svgEl("circle", { cx: "10", cy: "10", r: "5.5", fill: "none", stroke: "currentColor", "stroke-width": "1.8" }),
    svgEl("circle", { cx: "10", cy: "10", r: "1.8", fill: "currentColor" }),
    svgEl("path", { d: "M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" }),
  );
  return icon;
}
