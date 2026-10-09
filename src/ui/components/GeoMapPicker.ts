import { geoCatalogueCount } from "../../core/geoguessr/catalogue";
import { GEO_GAME_MAPS, type GeoGameMap } from "../../core/geoguessr/maps";
import { el } from "../dom/createElement";

function artwork(map: GeoGameMap, className: string): HTMLElement {
  const country = map.category === "Countries";
  const images = country ? [el("span", { className: "geo-country-shape", attrs: {
    style: `--country-shape:url(/assets/country-shapes/${map.artwork.toLowerCase()}.svg)`,
  } })] : (["light", "dark"] as const).map(theme => el("img", { attrs: {
    src: `/assets/geoguessr/maps/${map.id || "world"}${theme === "dark" ? "-dark" : ""}.svg`,
    "data-map-theme": theme,
    alt: "", width: "360", height: "180", decoding: "async", loading: className.includes("card") ? "lazy" : "eager",
  } }));
  return el("div", { className: `${className}${country ? " is-country" : ""}`, attrs: { "aria-hidden": "true", style: `--map-color:${map.color}` }, children: [...images, el("span", { className: "geo-atlas-dot" })] });
}

/** A dedicated map lobby; choosing a card never starts or abandons a game by itself. */
export function createGeoMapPicker(options: {
  initial: GeoGameMap;
  signal: AbortSignal;
  onPlay: (map: GeoGameMap) => void;
  onClose: () => void;
  best: (map: GeoGameMap) => number;
}) {
  let selected = options.initial;
  let category = "All maps";
  let hasGame = false;
  const title = el("h1", { text: "Where will you go?", attrs: { tabindex: "-1" } });
  const search = el("input", { className: "geo-atlas-search", attrs: { type: "search", placeholder: "Find a country or region…", "aria-label": "Search maps", autocomplete: "off" } });
  const featured = el("aside", { className: "geo-atlas-featured", attrs: { "aria-label": "Selected map" } });
  const grid = el("div", { className: "geo-atlas-grid", attrs: { role: "group", "aria-label": "Choose a map" } });
  const count = el("span", { className: "geo-atlas-count", attrs: { "aria-live": "polite" } });
  const mobilePlay = el("button", { className: "geo-button geo-primary geo-atlas-mobile-start", text: `Play ${selected.name} →`, attrs: { type: "button" }, on: { click: () => options.onPlay(selected) } });
  const close = el("button", { className: "geo-button geo-atlas-close", text: "Back to game", attrs: { type: "button", hidden: "true" }, on: { click: options.onClose } });
  const tabs = ["All maps", "World", "Regions", "Countries"].map(name => el("button", {
    className: "geo-button geo-atlas-tab", text: name,
    attrs: { type: "button", "aria-pressed": String(name === category) },
    on: { click: () => { category = name; tabs.forEach(tab => tab.setAttribute("aria-pressed", String(tab.textContent === name))); renderGrid(); } },
  }));
  const element = el("section", { className: "geo-atlas", attrs: { "aria-label": "Explore maps" }, children: [
    el("div", { className: "geo-atlas-inner", children: [
      el("header", { className: "geo-atlas-heading", children: [el("div", { children: [el("span", { className: "geo-atlas-eyebrow", text: "Pick a map. Find your adventure." }), title, el("p", { text: "The world is waiting. Choose your next five stops." })] }), close] }),
      el("div", { className: "geo-atlas-layout", children: [featured, el("div", { className: "geo-atlas-browser", children: [
        el("div", { className: "geo-atlas-filters", children: [el("div", { className: "geo-atlas-tabs", attrs: { role: "group", "aria-label": "Filter maps" }, children: tabs }), search] }),
        el("div", { className: "geo-atlas-grid-heading", children: [el("strong", { text: "Explore somewhere new" }), count] }), grid,
      ] })] }),
    ] }),
    el("div", { className: "geo-atlas-mobile-launch", children: [mobilePlay] }),
  ] });
  function renderFeatured(): void {
    const best = options.best(selected);
    mobilePlay.textContent = `Play ${selected.name} →`;
    const play = el("button", { className: "geo-button geo-primary geo-start-map", text: `Play ${selected.name} →`, attrs: { type: "button" }, on: { click: () => options.onPlay(selected) } });
    featured.style.setProperty("--map-color", selected.color);
    featured.replaceChildren(
      el("div", { className: "geo-atlas-hero", children: [el("span", { className: "geo-atlas-badge", text: selected.category === "World" ? "The whole adventure" : selected.category === "Regions" ? "Go beyond borders" : "A closer look" }), artwork(selected, "geo-atlas-hero-art"), el("span", { className: "geo-atlas-hero-caption", text: "A new perspective, every round" })] }),
      el("div", { className: "geo-atlas-featured-copy", children: [el("span", { className: "geo-atlas-eyebrow", text: `${selected.category} map` }), el("h2", { text: selected.name }), el("p", { text: selected.description }),
        el("div", { className: "geo-atlas-facts", children: [el("span", { text: `${geoCatalogueCount(selected.id).toLocaleString()} locations`, attrs: { title: "Unique panorama references. Google checks current availability when a round loads." } }), el("span", { text: "5 rounds" }), el("span", { text: "25,000 points" }), el("span", { text: "Google Street View" })] }),
        ...(best > 0 ? [el("p", { className: "geo-atlas-best", text: `Your best on this map · ${best.toLocaleString()} points` })] : []), play,
        el("span", { className: "geo-atlas-play-note", text: "Look around. Place a pin. See how close you get." }),
      ] }),
    );
  }
  function renderGrid(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const maps = GEO_GAME_MAPS.filter(map => (category === "All maps" || map.category === category) && `${map.name} ${map.category}`.toLocaleLowerCase().includes(query));
    count.textContent = `${maps.length} ${maps.length === 1 ? "map" : "maps"}`;
    grid.replaceChildren(...maps.map(map => {
      const button = el("button", { className: "geo-atlas-card", attrs: { type: "button", "data-map": map.id, "aria-pressed": String(map.id === selected.id), "aria-label": `Choose ${map.name} map`, style: `--map-color:${map.color}` }, children: [
        artwork(map, "geo-atlas-card-art"),
        el("span", { className: "geo-atlas-card-type", text: map.category === "Countries" ? "Country" : map.category === "Regions" ? "Region" : "Worldwide" }),
        el("strong", { text: map.name }), el("span", { className: "geo-atlas-card-check", text: "✓", attrs: { "aria-hidden": "true" } }),
        ...(map.category === "Countries" ? [el("img", { className: "geo-atlas-flag", attrs: { src: `/assets/flags/${map.artwork.toLowerCase()}.svg`, width: "24", height: "16", alt: "" } })] : []),
      ] });
      button.addEventListener("click", () => {
        selected = map;
        for (const card of grid.querySelectorAll("button")) card.setAttribute("aria-pressed", String((card as HTMLElement).dataset.map === map.id));
        renderFeatured();
      }, { signal: options.signal });
      return button;
    }));
    if (!maps.length) grid.append(el("p", { className: "geo-atlas-empty", text: "No maps found. Try another country or region." }));
  }
  search.addEventListener("input", renderGrid, { signal: options.signal });
  element.addEventListener("keydown", event => { if (event.key === "Escape" && hasGame) { event.stopPropagation(); options.onClose(); } }, { signal: options.signal });
  renderFeatured(); renderGrid();
  return {
    element,
    open(map: GeoGameMap, canClose: boolean) {
      selected = map; hasGame = canClose; close.hidden = !canClose;
      renderFeatured(); renderGrid(); element.hidden = false; title.focus();
    },
    close() { element.hidden = true; },
  };
}
