// Locator map for the country profile: the world map framed on one country, its neighbours
// tinted and clickable, and the capital marked with a labelled dot.

import type { CountryId, CountryIndex } from "../../../core/countries";
import { MAP_VIEWBOX_HEIGHT, MAP_VIEWBOX_WIDTH, projectWorldMapPosition, type WorldCountryFeature, type WorldMapPolygon } from "../../../core/map";
import type { CountryProfile } from "../../../core/countries/profiles";
import { createWorldMapView, type WorldMapView } from "../../dom/renderWorldMap";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_VIEW_WIDTH = 34;
const VIEW_PADDING = 2.1;
const ASPECT = MAP_VIEWBOX_HEIGHT / MAP_VIEWBOX_WIDTH;

export interface ProfileLocatorOptions {
  readonly profile: CountryProfile;
  readonly neighbourCodes: readonly string[];
  readonly features: readonly WorldCountryFeature[];
  readonly countryIndex: CountryIndex;
  readonly onOpenCountry: (code: string) => void;
}

export interface ProfileLocator {
  readonly element: HTMLElement;
  readonly view: WorldMapView;
  readonly destroy: () => void;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function polygonRect(polygon: WorldMapPolygon): Rect | null {
  const ring = polygon[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const position of ring) {
    const [x, y] = projectWorldMapPosition(position);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

function distanceToPoint(rect: Rect, [px, py]: readonly [number, number]): number {
  const dx = Math.max(0, rect.x - px, px - (rect.x + rect.width));
  const dy = Math.max(0, rect.y - py, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Map-space rectangle worth framing for a country: start from the landmass nearest the capital
 * and grow by absorbing nearby islands, so far-flung territories (French Guiana, Chukotka across
 * the date line) don't zoom the map out to the whole world.
 */
export function countryFrame(feature: WorldCountryFeature | undefined, anchorLatLng: readonly [number, number] | null): Rect | null {
  const anchor = anchorLatLng ? projectWorldMapPosition([anchorLatLng[1], anchorLatLng[0]]) : null;
  if (!feature) {
    return anchor ? { x: anchor[0], y: anchor[1], width: 0, height: 0 } : null;
  }
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const rects = polygons.map(polygonRect).filter((rect): rect is Rect => rect !== null);
  if (rects.length === 0) return null;

  const size = (r: Rect) => r.width * r.height;
  const start = anchor
    ? rects.reduce((best, rect) => {
        const d = distanceToPoint(rect, anchor) - distanceToPoint(best, anchor);
        return d < -0.01 || (Math.abs(d) <= 0.01 && size(rect) > size(best)) ? rect : best;
      })
    : rects.reduce((best, rect) => (size(rect) > size(best) ? rect : best));

  let frame = start;
  let remaining = rects.filter((rect) => rect !== start);
  // Reach is fixed by the home landmass so a trail of tiny islets can't snowball the frame.
  const reach = Math.max(6, Math.max(start.width, start.height) * 0.45);
  let grew = true;
  while (grew && remaining.length) {
    grew = false;
    const next: Rect[] = [];
    for (const rect of remaining) {
      if (gapBetween(frame, rect) <= reach) { frame = union(frame, rect); grew = true; } else next.push(rect);
    }
    remaining = next;
  }
  if (anchor) frame = union(frame, { x: anchor[0], y: anchor[1], width: 0, height: 0 });
  return frame;
}

/** Padded 2:1 view around a frame, never tighter than MIN_VIEW_WIDTH map units. */
export function viewForFrame(frame: Rect, padding = VIEW_PADDING, minWidth = MIN_VIEW_WIDTH): Rect {
  // Continent-sized countries already fill the frame; heavy padding would just show the world.
  if (Math.max(frame.width, frame.height / ASPECT) > 160) padding = Math.min(padding, 1.3);
  const width = Math.min(MAP_VIEWBOX_WIDTH, Math.max(minWidth, frame.width * padding, (frame.height * padding) / ASPECT));
  const height = width * ASPECT;
  return { x: frame.x + frame.width / 2 - width / 2, y: frame.y + frame.height / 2 - height / 2, width, height };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function createProfileLocator(options: ProfileLocatorOptions): ProfileLocator {
  const { profile, countryIndex } = options;
  const neighbourSet = new Set(options.neighbourCodes);
  const selfCountry = countryIndex.byCode.get(profile.code);

  const view = createWorldMapView(options.features, countryIndex, {
    onCountryClick: (countryId: CountryId) => {
      const country = countryIndex.byId[countryId];
      if (country && country.code !== profile.code) options.onOpenCountry(country.code);
    },
  });

  for (const [countryId, path] of view.pathByCountryId) {
    const country = countryIndex.byId[countryId];
    if (!country) continue;
    if (country.code === profile.code) path.classList.add("is-cp-self");
    else if (neighbourSet.has(country.code)) path.classList.add("is-cp-neighbour");
    path.setAttribute("aria-label", country.name);
  }
  const selfPath = selfCountry ? view.pathByCountryId.get(selfCountry.id) : undefined;
  // Draw the country above its neighbours so its full outline stroke shows.
  selfPath?.parentNode?.append(selfPath);

  const svg = view.element.querySelector("svg");
  const neighbourText = options.neighbourCodes.length ? `, with its ${options.neighbourCodes.length === 1 ? "neighbour" : "neighbours"} shaded` : "";
  svg?.setAttribute("aria-label", `Map of ${profile.name} and the surrounding region${neighbourText}. Its capital, ${profile.capital}, is marked.`);

  // Tiny countries can vanish at world scale: ring them so the eye finds them.
  const tiny = profile.areaKm2 < 3000;

  const markers = svgEl("g", { class: "cp-map-markers", "aria-hidden": "true" });
  const capitalPoint = profile.capitalLatLng ? projectWorldMapPosition([profile.capitalLatLng[1], profile.capitalLatLng[0]]) : null;
  const ring = tiny && capitalPoint ? svgEl("circle", { class: "cp-map-ring", cx: capitalPoint[0].toFixed(3), cy: capitalPoint[1].toFixed(3) }) : null;
  const dot = capitalPoint ? svgEl("circle", { class: "cp-map-capital", cx: capitalPoint[0].toFixed(3), cy: capitalPoint[1].toFixed(3) }) : null;
  const label = capitalPoint ? svgEl("text", { class: "cp-map-capital-label", x: capitalPoint[0].toFixed(3), y: capitalPoint[1].toFixed(3) }) : null;
  if (label) label.textContent = profile.capital;
  if (ring) markers.append(ring);
  if (dot) markers.append(dot);
  if (label) markers.append(label);
  svg?.append(markers);

  // Markers are sized in screen pixels, so they read the same on a phone and a desktop.
  function scaleMarkers(): void {
    const width = Number(svg?.getAttribute("viewBox")?.split(" ")[2]);
    if (!Number.isFinite(width) || width <= 0) return;
    const rendered = svg?.getBoundingClientRect().width || 800;
    const px = width / rendered;
    dot?.setAttribute("r", (px * 4.5).toFixed(3));
    dot?.setAttribute("stroke-width", (px * 2).toFixed(3));
    ring?.setAttribute("r", (px * 17).toFixed(3));
    ring?.setAttribute("stroke-width", (px * 1.6).toFixed(3));
    ring?.setAttribute("stroke-dasharray", `${(px * 4).toFixed(3)} ${(px * 3).toFixed(3)}`);
    if (label && capitalPoint) {
      label.setAttribute("font-size", (px * (rendered < 500 ? 13 : 17)).toFixed(3));
      label.setAttribute("x", (capitalPoint[0] + px * (ring ? 21 : 9)).toFixed(3));
      label.setAttribute("y", (capitalPoint[1] + px * 5).toFixed(3));
      label.setAttribute("stroke-width", (px * 3.5).toFixed(3));
    }
  }
  const observer = typeof MutationObserver === "function" && svg ? new MutationObserver(scaleMarkers) : null;
  if (svg) observer?.observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
  const resizeObserver = typeof ResizeObserver === "function" && svg ? new ResizeObserver(scaleMarkers) : null;
  if (svg) resizeObserver?.observe(svg);

  // Hover names every country, so the map doubles as a way to wander the atlas.
  const onOver = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest<SVGPathElement>(".world-map-country[data-country-id]") : null;
    view.showCountryLabel(target ? Number(target.dataset.countryId) : null);
  };
  const onLeave = () => view.showCountryLabel(null);
  svg?.addEventListener("pointerover", onOver);
  svg?.addEventListener("pointerleave", onLeave);

  const frame = countryFrame(options.features.find((f) => f.code.toUpperCase() === profile.code), profile.capitalLatLng ?? profile.latlng);
  // Small island nations get a wider window so the ocean around them gives some context.
  const minWidth = profile.borders.length === 0 && profile.areaKm2 < 30_000 ? 90 : MIN_VIEW_WIDTH;
  const target = frame ? viewForFrame(frame, VIEW_PADDING, minWidth) : null;
  if (target) {
    if (prefersReducedMotion()) {
      view.focusBounds(target, { animate: false });
    } else {
      // Start a little wider and glide in: a quiet "zoom to the place" moment.
      view.focusBounds(viewForFrame(frame!, VIEW_PADDING * 2.6, minWidth * 2.6), { animate: false });
      requestAnimationFrame(() => view.focusBounds(target, { animate: true }));
    }
  }
  scaleMarkers();

  const element = document.createElement("div");
  element.className = "cp-locator";
  element.append(view.element);

  return {
    element,
    view,
    destroy: () => {
      observer?.disconnect();
      resizeObserver?.disconnect();
      svg?.removeEventListener("pointerover", onOver);
      svg?.removeEventListener("pointerleave", onLeave);
    },
  };
}

/**
 * Outline drawn from the map geometry, for archipelagos whose outline asset is unusable
 * (date-line artefacts, or atolls too small to see). Frames the island group round the capital.
 */
export function createFeatureSilhouette(feature: WorldCountryFeature, anchorLatLng: readonly [number, number] | null, label: string): SVGSVGElement | null {
  const frame = countryFrame(feature, anchorLatLng);
  if (!frame) return null;
  const size = Math.max(frame.width, frame.height, 0.5) * 1.15;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const svg = svgEl("svg", {
    class: "cp-feature-shape",
    viewBox: `${(cx - size / 2).toFixed(3)} ${(cy - size / 2).toFixed(3)} ${size.toFixed(3)} ${size.toFixed(3)}`,
    role: "img",
    "aria-label": label,
    preserveAspectRatio: "xMidYMid meet",
  });
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const d = polygons
    .map((polygon) => polygon.map((ring) => ring.map((position, i) => {
      const [x, y] = projectWorldMapPosition(position);
      return `${i === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`;
    }).join("") + "Z").join(""))
    .join("");
  // A non-scaling stroke keeps specks of atoll visible at any size.
  svg.append(svgEl("path", { d, "vector-effect": "non-scaling-stroke" }));
  return svg;
}
