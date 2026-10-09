// Decorative SVG thumbnails derived from our shipped map; game geometry stays untouched.
import { readFile, writeFile, mkdir } from "node:fs/promises";
const world = JSON.parse(await readFile(new URL("../public/assets/world-map.json", import.meta.url), "utf8"));
const output = new URL("../public/assets/geoguessr/maps/", import.meta.url);
await mkdir(output, { recursive: true });
const palettes = {
  light: { world: "#4e8775", europe: "#789164", asia: "#b9885c", africa: "#b9924d", "north-america": "#4d9389", "south-america": "#7a9861", oceania: "#638ca5" },
  dark: { world: "#8eb7a5", europe: "#a8b98c", asia: "#d1a17b", africa: "#d3b577", "north-america": "#8ac0b5", "south-america": "#a3ba87", oceania: "#92b3c5" },
};
function simplify(points, tolerance = .35) {
  if (points.length < 3) return points;
  const first = points[0], last = points.at(-1);
  const dx = last[0] - first[0], dy = last[1] - first[1];
  let index = 0, furthest = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = (p[0] - first[0] - t * dx) ** 2 + (p[1] - first[1] - t * dy) ** 2;
    if (distance > furthest) { index = i; furthest = distance; }
  }
  return index ? [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)] : [first, last];
}
for (const [theme, colors] of Object.entries(palettes)) {
  for (const [region, color] of Object.entries(colors)) {
    const paths = world.flatMap(feature => {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const commands = polygons.flatMap(polygon => polygon.flatMap(ring => {
        if (!ring.length) return [];
        const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
        const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
        if (width > 180 || width * height < .8) return [];
        const points = simplify(ring);
        return points.length < 4 ? [] : ["M" + points.map(([lng, lat]) => `${(lng + 180).toFixed(1)},${(90 - lat).toFixed(1)}`).join("L") + "Z"];
      })).join("");
      if (!commands) return [];
      const selected = region === "world" || feature.continent.toLowerCase().replaceAll(" ", "-") === region;
      return [`<path d="${commands}" fill="${selected ? color : theme === "light" ? "#cfd8cc" : "#3d5345"}" opacity="${selected ? 1 : .7}"/>`];
    }).join("");
    await writeFile(new URL(`${region}${theme === "dark" ? "-dark" : ""}.svg`, output), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180"><g fill-rule="evenodd" stroke="${theme === "light" ? "#f3f5eb" : "#1c2820"}" stroke-width=".3">${paths}</g></svg>\n`);
  }
}
