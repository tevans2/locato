import type { Country, CountryId, CountryIndex } from "../../core/countries";
import {
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  projectWorldMapPosition,
  type ProjectedPoint,
  type WorldCountryFeature,
  type WorldMapPolygon,
  type WorldMapPosition,
} from "../../core/map";
import { el } from "./createElement";

const SVG_NS = "http://www.w3.org/2000/svg";
const RECENT_LABEL_COUNT = 8;
const RECENT_LIST_COUNT = 5;

export interface CapitalRecallMapView {
  readonly element: HTMLElement;
  readonly update: (guessedCountryIds: ReadonlySet<CountryId>, currentCountryId: CountryId | null, latestCountryId: CountryId | null) => void;
}

interface MarkerEntry {
  readonly group: SVGGElement;
  readonly label: SVGTextElement;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function formatPoint(point: WorldMapPosition): string {
  const [x, y] = projectWorldMapPosition(point);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

function polygonToPath(polygon: WorldMapPolygon): string {
  return polygon
    .map((ring) => ring.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPoint(point)}`).join(" ") + " Z")
    .join(" ");
}

function geometryToPath(feature: WorldCountryFeature): string {
  if (feature.geometry.type === "Polygon") return polygonToPath(feature.geometry.coordinates);
  return feature.geometry.coordinates.map(polygonToPath).join(" ");
}

function ringArea(points: readonly ProjectedPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(points: readonly ProjectedPoint[]): ProjectedPoint | null {
  let twiceArea = 0;
  let xTotal = 0;
  let yTotal = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xTotal += (x1 + x2) * cross;
    yTotal += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 0.0001) return null;
  return [xTotal / (3 * twiceArea), yTotal / (3 * twiceArea)];
}

function centerOfBounds(points: readonly ProjectedPoint[]): ProjectedPoint {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function polygonArea(polygon: WorldMapPolygon): number {
  const outerRing = polygon[0];
  if (!outerRing) return 0;
  return Math.abs(ringArea(outerRing.map(projectWorldMapPosition)));
}

function countryCenter(feature: WorldCountryFeature): ProjectedPoint | null {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let largestPolygon: WorldMapPolygon | null = null;
  let largestArea = -1;

  for (const polygon of polygons) {
    const area = polygonArea(polygon);
    if (area > largestArea) {
      largestPolygon = polygon;
      largestArea = area;
    }
  }

  const outerRing = largestPolygon?.[0];
  if (!outerRing || outerRing.length === 0) return null;

  const points = outerRing.map(projectWorldMapPosition);
  return ringCentroid(points) ?? centerOfBounds(points);
}

function recentCountries(countryIndex: CountryIndex, guessedCountryIds: ReadonlySet<CountryId>, count: number): readonly Country[] {
  return [...guessedCountryIds]
    .slice(-count)
    .reverse()
    .map((countryId) => countryIndex.byId[countryId])
    .filter((country): country is Country => country !== undefined);
}

export function createCapitalRecallMapView(features: readonly WorldCountryFeature[], countryIndex: CountryIndex): CapitalRecallMapView {
  const playableCapitalTotal = countryIndex.countries.filter((country) => country.capital.length > 0).length;
  const pathByCountryId = new Map<CountryId, SVGPathElement>();
  const markerByCountryId = new Map<CountryId, MarkerEntry>();
  let previousLatestCountryId: CountryId | null = null;

  const svg = createSvgElement("svg");
  svg.setAttribute("viewBox", `0 0 ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map of solved capital cities");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("class", "capital-recall-map-svg");

  const mapLayer = createSvgElement("g");
  const markerLayer = createSvgElement("g");
  markerLayer.setAttribute("class", "capital-recall-marker-layer");

  for (const feature of features) {
    const country = countryIndex.byCode.get(feature.code.toUpperCase());
    const path = createSvgElement("path");
    path.setAttribute("d", geometryToPath(feature));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.classList.add("capital-recall-country");

    if (country) {
      path.dataset.countryId = String(country.id);
      pathByCountryId.set(country.id, path);

      const center = countryCenter(feature);
      if (center && country.capital.length > 0) {
        const [x, y] = center;
        const group = createSvgElement("g");
        group.classList.add("capital-recall-marker");
        group.dataset.countryId = String(country.id);

        const halo = createSvgElement("circle");
        halo.classList.add("capital-recall-marker-halo");
        halo.setAttribute("cx", x.toFixed(3));
        halo.setAttribute("cy", y.toFixed(3));
        halo.setAttribute("r", "8.4");

        const dot = createSvgElement("circle");
        dot.classList.add("capital-recall-marker-dot");
        dot.setAttribute("cx", x.toFixed(3));
        dot.setAttribute("cy", y.toFixed(3));
        dot.setAttribute("r", "3.4");

        const label = createSvgElement("text");
        label.classList.add("capital-recall-marker-label");
        label.setAttribute("x", x.toFixed(3));
        label.setAttribute("y", Math.max(14, y - 13).toFixed(3));
        label.setAttribute("text-anchor", "middle");
        label.textContent = country.capital;

        const title = createSvgElement("title");
        title.textContent = `${country.capital}, ${country.name}`;

        group.append(title, halo, dot, label);
        markerByCountryId.set(country.id, { group, label });
        markerLayer.append(group);
      }
    } else {
      path.classList.add("is-unplayable");
    }

    mapLayer.append(path);
  }

  svg.append(mapLayer, markerLayer);

  const currentPrefix = el("span", { className: "capital-map-current-prefix", text: "Capital of" });
  const currentName = el("strong", { className: "capital-map-current-name" });
  const progress = el("span", { className: "capital-map-progress" });
  const currentPanel = el("div", {
    className: "capital-map-current",
    children: [el("div", { className: "capital-map-current-copy", children: [currentPrefix, currentName] }), progress],
  });
  const recentList = el("div", { className: "capital-map-recent", attrs: { "aria-label": "Recent solved capitals" } });
  const element = el("div", { className: "capital-recall-map-panel", children: [svg, currentPanel, recentList] });

  function update(guessedCountryIds: ReadonlySet<CountryId>, currentCountryId: CountryId | null, latestCountryId: CountryId | null): void {
    const recentLabelIds = new Set(recentCountries(countryIndex, guessedCountryIds, RECENT_LABEL_COUNT).map((country) => country.id));
    for (const [countryId, path] of pathByCountryId) {
      path.classList.toggle("is-solved", guessedCountryIds.has(countryId));
      path.classList.toggle("is-current", countryId === currentCountryId);
    }

    for (const [countryId, marker] of markerByCountryId) {
      const solved = guessedCountryIds.has(countryId);
      const latest = countryId === latestCountryId;
      marker.group.classList.toggle("is-solved", solved);
      marker.group.classList.toggle("is-latest", latest);
      marker.label.classList.toggle("is-recent", recentLabelIds.has(countryId));
      if (latest && latestCountryId !== previousLatestCountryId) {
        marker.group.classList.remove("is-popping");
        marker.group.getBoundingClientRect();
        marker.group.classList.add("is-popping");
      }
    }

    previousLatestCountryId = latestCountryId;
    const currentCountry = currentCountryId === null ? null : countryIndex.byId[currentCountryId] ?? null;
    currentName.textContent = currentCountry?.name ?? "Complete";
    progress.textContent = `${Math.min(guessedCountryIds.size, playableCapitalTotal)} / ${playableCapitalTotal}`;

    const recent = recentCountries(countryIndex, guessedCountryIds, RECENT_LIST_COUNT);
    recentList.hidden = recent.length === 0;
    recentList.replaceChildren(
      ...recent.map((country) =>
        el("span", {
          className: "capital-map-recent-chip",
          children: [el("strong", { text: country.capital }), el("span", { text: country.code })],
        }),
      ),
    );
  }

  update(new Set(), null, null);

  return { element, update };
}
