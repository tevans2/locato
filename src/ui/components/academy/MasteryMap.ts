import { countryMastery, groupForCountry, type AcademyProgress, type LearningGroup, type MasteryLevel } from "../../../core/academy";
import type { Continent, CountryCode, CountryId, CountryIndex } from "../../../core/countries";
import { projectWorldMapPosition, type WorldCountryFeature, type WorldMapPolygon } from "../../../core/map";
import { el } from "../../dom/createElement";
import { createWorldMapView, type WorldMapView } from "../../dom/renderWorldMap";

/**
 * The Academy's world map: every country tinted by how well the player knows it. Clicking a
 * country (or a microstate's dot) selects it; the hub opens that country's learning group.
 */

export const MASTERY_LABELS: Readonly<Record<MasteryLevel, string>> = {
  new: "Not started",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered",
};

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Hand-framed continent views (lon/lat boxes) so e.g. Europe isn't stretched out by all of Russia. */
const CONTINENT_FRAMES: Readonly<Record<Continent, readonly [number, number, number, number]>> = {
  Africa: [-26, -37, 58, 39],
  Asia: [24, -12, 150, 56],
  Europe: [-26, 34, 46, 71],
  "North America": [-170, 6, -50, 74],
  Oceania: [110, -48, 180, 12],
  "South America": [-88, -56, -30, 14],
};

/** Countries whose outline is too small to click at world zoom get a visible, clickable dot. */
const TINY_COUNTRY_AREA = 3.2;
const TINY_COUNTRY_SPAN = 3;

export interface MasteryMapOptions {
  readonly features: readonly WorldCountryFeature[];
  readonly countryIndex: CountryIndex;
  readonly onSelectCountry: (code: CountryCode) => void;
}

export interface MasteryMap {
  readonly element: HTMLElement;
  readonly update: (progress: AcademyProgress) => void;
  /** Highlight a group's countries (null clears) and optionally frame them. */
  readonly showGroup: (group: LearningGroup | null, options?: { readonly focus?: boolean; readonly animate?: boolean }) => void;
  readonly setPicked: (code: CountryCode | null) => void;
  /** Temporarily emphasise one country, e.g. while its row is hovered in the group panel. */
  readonly setHot: (code: CountryCode | null) => void;
  readonly focusContinent: (continent: Continent | null, options?: { readonly animate?: boolean }) => void;
  readonly destroy: () => void;
}

function ringArea(points: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function boundsOf(points: readonly (readonly [number, number])[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface CountryGeometryInfo {
  /** Bounds of the largest landmass: frames France without French Guiana, Kiribati without the date line. */
  readonly mainBounds: Bounds;
  readonly tiny: boolean;
}

function measureFeature(feature: WorldCountryFeature): CountryGeometryInfo | null {
  const polygons: readonly WorldMapPolygon[] = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let totalArea = 0;
  let largest: { area: number; bounds: Bounds } | null = null;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const points = outer.map(projectWorldMapPosition);
    const area = ringArea(points);
    const bounds = boundsOf(points);
    totalArea += area;
    if (bounds && (!largest || area > largest.area)) largest = { area, bounds };
  }
  if (!largest) return null;
  const span = Math.max(largest.bounds.width, largest.bounds.height);
  return { mainBounds: largest.bounds, tiny: totalArea < TINY_COUNTRY_AREA || span < TINY_COUNTRY_SPAN };
}

function unionBounds(list: readonly Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  const minX = Math.min(...list.map((b) => b.x));
  const minY = Math.min(...list.map((b) => b.y));
  const maxX = Math.max(...list.map((b) => b.x + b.width));
  const maxY = Math.max(...list.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function padBounds(bounds: Bounds, ratio: number, minWidth: number): Bounds {
  const width = Math.max(minWidth, bounds.width * (1 + ratio * 2));
  const height = Math.max(minWidth / 2, bounds.height * (1 + ratio * 2));
  return { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height };
}

function frameToBounds([west, south, east, north]: readonly [number, number, number, number]): Bounds {
  const [x1, y1] = projectWorldMapPosition([west, north]);
  const [x2, y2] = projectWorldMapPosition([east, south]);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function createMasteryMap(options: MasteryMapOptions): MasteryMap {
  const { countryIndex } = options;
  const map: WorldMapView = createWorldMapView(options.features, countryIndex, {
    onCountryClick: (countryId) => {
      const country = countryIndex.byId[countryId];
      if (country) options.onSelectCountry(country.code);
    },
  });
  const svg = map.element.querySelector("svg");
  svg?.setAttribute("aria-label", "World mastery map. Countries are shaded by how well you know them; select one to open its learning group. Drag to pan, scroll to zoom.");

  const infoById = new Map<CountryId, CountryGeometryInfo>();
  for (const feature of options.features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    const info = country ? measureFeature(feature) : null;
    if (country && info) infoById.set(country.id, info);
  }

  const tinyIds = new Set<CountryId>();
  for (const [id, dot] of map.missingDotByCountryId) {
    if (!infoById.get(id)?.tiny) continue;
    tinyIds.add(id);
    dot.classList.add("academy-map-dot");
  }

  // Caption card (top-left): whatever is hovered, else the picked country.
  const captionFlag = el("img", { className: "academy-map-caption-flag", attrs: { alt: "", width: "30", height: "20" } });
  const captionName = el("strong", { className: "academy-map-caption-name" });
  const captionMeta = el("span", { className: "academy-map-caption-meta" });
  const caption = el("div", {
    className: "academy-map-caption",
    attrs: { "aria-live": "polite", hidden: "" },
    children: [captionFlag, el("span", { className: "academy-map-caption-text", children: [captionName, captionMeta] })],
  });

  const legend = el("ul", {
    className: "academy-map-legend",
    attrs: { "aria-label": "Map key" },
    children: (Object.keys(MASTERY_LABELS) as MasteryLevel[]).map((level) =>
      el("li", { attrs: { "data-mastery": level }, children: [el("span", { className: "academy-map-swatch", attrs: { "aria-hidden": "true" } }), document.createTextNode(MASTERY_LABELS[level])] }),
    ),
  });

  // Focusable (programmatically) so focus can return here after a group opened from the map closes.
  const element = el("div", { className: "academy-map", attrs: { tabindex: "-1" }, children: [map.element, caption, legend] });

  let progress: AcademyProgress | null = null;
  let hoveredId: CountryId | null = null;
  let pickedId: CountryId | null = null;
  let hotId: CountryId | null = null;

  function idForCode(code: CountryCode | null): CountryId | null {
    return code ? countryIndex.byCode.get(code.toUpperCase())?.id ?? null : null;
  }

  function renderCaption(): void {
    const id = hoveredId ?? pickedId;
    const country = id === null ? null : countryIndex.byId[id] ?? null;
    caption.hidden = country === null;
    if (!country) return;
    const level = progress ? countryMastery(progress, country.code) : "new";
    captionFlag.src = country.flagSrc;
    captionName.textContent = country.name;
    const group = groupForCountry(country.code);
    captionMeta.textContent = group ? `${MASTERY_LABELS[level]} · ${group.title}` : MASTERY_LABELS[level];
    caption.dataset.mastery = level;
  }

  function toggleOn(id: CountryId | null, className: string, on: boolean): void {
    if (id === null) return;
    map.pathByCountryId.get(id)?.classList.toggle(className, on);
    map.missingDotByCountryId.get(id)?.classList.toggle(className, on);
  }

  function countryIdFromTarget(target: EventTarget | null): CountryId | null {
    const node = target instanceof Element ? target.closest<SVGElement>("[data-country-id]") : null;
    if (!node) return null;
    if (node.classList.contains("world-map-missing-dot") && !node.classList.contains("academy-map-dot")) return null;
    const id = Number(node.dataset.countryId);
    return Number.isInteger(id) ? id : null;
  }

  function onPointerOver(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    const id = countryIdFromTarget(event.target);
    if (id === hoveredId) return;
    hoveredId = id;
    renderCaption();
  }

  function onPointerLeave(): void {
    hoveredId = null;
    renderCaption();
  }

  // Microstate dots sit in a pointer-transparent layer upstream, and the map captures the
  // pointer while panning, so detect a still tap on a dot ourselves.
  let dotPress: { readonly id: CountryId; readonly x: number; readonly y: number } | null = null;
  function onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target.closest<SVGElement>(".academy-map-dot") : null;
    const id = target ? Number(target.dataset.countryId) : NaN;
    dotPress = Number.isInteger(id) ? { id, x: event.clientX, y: event.clientY } : null;
  }
  function onPointerUp(event: PointerEvent): void {
    const press = dotPress;
    dotPress = null;
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) return;
    const country = countryIndex.byId[press.id];
    if (country) options.onSelectCountry(country.code);
  }

  svg?.addEventListener("pointerover", onPointerOver);
  svg?.addEventListener("pointerleave", onPointerLeave);
  svg?.addEventListener("pointerdown", onPointerDown, { capture: true });
  svg?.addEventListener("pointerup", onPointerUp);

  function update(next: AcademyProgress): void {
    progress = next;
    for (const [id, path] of map.pathByCountryId) {
      const country = countryIndex.byId[id];
      if (!country) continue;
      const level = countryMastery(next, country.code);
      path.dataset.mastery = level;
      const dot = map.missingDotByCountryId.get(id);
      if (dot && tinyIds.has(id)) dot.dataset.mastery = level;
    }
    renderCaption();
  }

  let groupIds = new Set<CountryId>();
  function showGroup(group: LearningGroup | null, showOptions: { readonly focus?: boolean; readonly animate?: boolean } = {}): void {
    for (const id of groupIds) toggleOn(id, "is-in-group", false);
    groupIds = new Set(group ? group.countryCodes.map((code) => idForCode(code)).filter((id): id is CountryId => id !== null) : []);
    for (const id of groupIds) toggleOn(id, "is-in-group", true);
    element.classList.toggle("has-group", group !== null);
    if (!group || !showOptions.focus) return;
    const bounds = unionBounds([...groupIds].map((id) => infoById.get(id)?.mainBounds).filter((b): b is Bounds => !!b));
    if (bounds) map.focusBounds(padBounds(bounds, 0.22, 60), { animate: showOptions.animate ?? true });
  }

  function setPicked(code: CountryCode | null): void {
    toggleOn(pickedId, "is-picked", false);
    pickedId = idForCode(code);
    toggleOn(pickedId, "is-picked", true);
    renderCaption();
  }

  function setHot(code: CountryCode | null): void {
    toggleOn(hotId, "is-hot", false);
    hotId = idForCode(code);
    toggleOn(hotId, "is-hot", true);
  }

  function focusContinent(continent: Continent | null, focusOptions: { readonly animate?: boolean } = {}): void {
    const animate = focusOptions.animate ?? true;
    if (!continent) {
      map.resetView({ animate });
      return;
    }
    map.focusBounds(frameToBounds(CONTINENT_FRAMES[continent]), { animate });
  }

  return {
    element,
    update,
    showGroup,
    setPicked,
    setHot,
    focusContinent,
    destroy: () => {
      svg?.removeEventListener("pointerover", onPointerOver);
      svg?.removeEventListener("pointerleave", onPointerLeave);
      svg?.removeEventListener("pointerdown", onPointerDown, { capture: true });
      svg?.removeEventListener("pointerup", onPointerUp);
    },
  };
}
