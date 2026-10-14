import type { CountryIndex } from "../../core/countries";
import { mainLandmassBounds, unionMapRects, type MapRect, type WorldCountryFeature } from "../../core/map";
import type { OverlandVerdict } from "../../core/overland";
import { createWorldMapView } from "../dom/renderWorldMap";
import { prefersReducedMotion } from "../shell/layer";

/**
 * The Overland map. Land is drawn as one silhouette with no borders, so the map shows where the
 * two ends are without giving the route away. Each guessed country is filled in with its verdict's
 * colour, hints add dashed outlines, and a finished route turns the borders on and fills in what
 * was missed. Only countries already on the map can be named by hovering or tapping them.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/** Countries whose home landmass is smaller than this (viewBox units) also get a ring marker. */
const TINY_COUNTRY_SPAN = 3;
/** Framing: padding around the marked countries (share of their size) and the smallest frame. */
const FRAME_PADDING = 0.35;
const MIN_FRAME_WIDTH = 70;
const MIN_FRAME_HEIGHT = 32;

export type OverlandMapTone = "start" | "end" | OverlandVerdict | "missed";
const TONE_CLASSES = ["start", "end", "route", "close", "detour", "off", "missed"].map((tone) => `is-ov-${tone}`);

export interface OverlandMap {
  readonly element: HTMLElement;
  /** Clear the map for a new route: only its two ends are filled in, and they're framed. */
  readonly showRoute: (start: string, end: string) => void;
  readonly mark: (code: string, tone: OverlandMapTone) => void;
  /** Take a country off the map again. */
  readonly unmark: (code: string) => void;
  /** Dashed outlines drawn by hints (replaces the previous set). */
  readonly setOutlined: (codes: readonly string[]) => void;
  /** Country borders: hidden while playing, shown once a route is over. */
  readonly setBordersVisible: (visible: boolean) => void;
  /** Fit every filled-in and outlined country in view. */
  readonly frame: (options?: { readonly animate?: boolean }) => void;
  readonly destroy: () => void;
}

export function createOverlandMap(features: readonly WorldCountryFeature[], countryIndex: CountryIndex): OverlandMap {
  const tones = new Map<string, OverlandMapTone>();
  let outlined = new Set<string>();

  const view = createWorldMapView(features, countryIndex, {
    onCountryClick: (countryId) => {
      const code = countryIndex.byId[countryId]?.code;
      view.showCountryLabel(code && tones.has(code) ? countryId : null);
    },
    recenter: { text: "Recentre", label: "Recentre the map on this route", onClick: () => frame({ animate: true }) },
  });
  view.element.classList.add("overland-map");
  view.element.querySelector("svg")?.setAttribute("aria-label", "Map of the route. Drag to pan and scroll to zoom.");

  const pathByCode = new Map<string, SVGPathElement>();
  const dotByCode = new Map<string, SVGCircleElement>();
  for (const [countryId, path] of view.pathByCountryId) {
    const code = countryIndex.byId[countryId]?.code;
    if (!code) continue;
    pathByCode.set(code, path);
    const dot = view.missingDotByCountryId.get(countryId);
    if (dot) dotByCode.set(code, dot);
  }
  const boundsByCode = new Map<string, MapRect>();
  const tiny = new Set<string>();
  for (const feature of features) {
    const code = feature.code.toUpperCase();
    const bounds = mainLandmassBounds(feature);
    if (!bounds) continue;
    boundsByCode.set(code, bounds);
    if (Math.max(bounds.width, bounds.height) < TINY_COUNTRY_SPAN) tiny.add(code);
  }

  function setTitle(path: SVGPathElement, text: string | null): void {
    path.querySelector("title")?.remove();
    if (!text) return;
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = text;
    path.append(title);
  }

  function clearTone(code: string): void {
    const path = pathByCode.get(code);
    path?.classList.remove(...TONE_CLASSES);
    if (path) setTitle(path, null);
    dotByCode.get(code)?.classList.remove("is-ov-marked", ...TONE_CLASSES);
  }

  function mark(code: string, tone: OverlandMapTone): void {
    const path = pathByCode.get(code);
    if (!path) return;
    clearTone(code);
    tones.set(code, tone);
    path.classList.add(`is-ov-${tone}`);
    setTitle(path, countryIndex.byCode.get(code)?.name ?? code);
    // Coloured outlines sit above their neighbours' strokes.
    path.parentNode?.append(path);
    if (tiny.has(code)) dotByCode.get(code)?.classList.add("is-ov-marked", `is-ov-${tone}`);
  }

  function setOutlined(codes: readonly string[]): void {
    for (const code of outlined) {
      pathByCode.get(code)?.classList.remove("is-ov-hinted");
      dotByCode.get(code)?.classList.remove("is-ov-hinted");
    }
    outlined = new Set(codes);
    for (const code of outlined) {
      const path = pathByCode.get(code);
      if (!path) continue;
      path.classList.add("is-ov-hinted");
      path.parentNode?.append(path);
      if (tiny.has(code)) dotByCode.get(code)?.classList.add("is-ov-hinted");
    }
  }

  function frame(options: { readonly animate?: boolean } = {}): void {
    const codes = [...tones.keys(), ...outlined];
    const rect = unionMapRects(codes.map((code) => boundsByCode.get(code)).filter((value): value is MapRect => value !== undefined));
    if (!rect) return;
    const width = Math.max(MIN_FRAME_WIDTH, rect.width * (1 + FRAME_PADDING * 2));
    const height = Math.max(MIN_FRAME_HEIGHT, rect.height * (1 + FRAME_PADDING * 2));
    view.focusBounds({ x: rect.x + rect.width / 2 - width / 2, y: rect.y + rect.height / 2 - height / 2, width, height }, { animate: (options.animate ?? false) && !prefersReducedMotion() });
  }

  return {
    element: view.element,
    showRoute(start, end) {
      for (const code of [...tones.keys()]) clearTone(code);
      tones.clear();
      setOutlined([]);
      view.showCountryLabel(null);
      view.element.classList.remove("has-borders");
      mark(start, "start");
      mark(end, "end");
      frame();
    },
    mark,
    unmark(code) {
      clearTone(code);
      tones.delete(code);
    },
    setOutlined,
    setBordersVisible(visible) {
      view.element.classList.toggle("has-borders", visible);
    },
    frame,
    destroy() {
      view.element.remove();
    },
  };
}
