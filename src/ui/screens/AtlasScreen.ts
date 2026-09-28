import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import { countryMastery, type AcademyProgress, type MasteryLevel } from "../../core/academy";
import { CONTINENTS, type Continent, type CountryIndex } from "../../core/countries";
import { allCountryProfiles, formatArea, formatPopulation, type CountryProfile } from "../../core/countries/profiles";
import { buildSearchEntries, normalizeSearch, searchCountries } from "../components/academy/profileSearch";
import { profileIcon } from "../components/academy/profileIcons";
import { el } from "../dom/createElement";
import { createSitePage, type ShellContext } from "../shell";
import "../../styles/atlas.css";

/*
 * Learn → Atlas (docs/navigation.md): an index of every country. Search by name, alias, capital
 * or code; filter by continent; sort A–Z, by population or by area. Each card opens the
 * country's profile. Replaces the old flag gallery (`?view=flags` is an alias).
 */

export interface AtlasScreenOptions {
  readonly shell: ShellContext;
  readonly countryIndex: CountryIndex;
  /** Academy progress, for each card's mastery pip. */
  readonly progressStore?: AcademyProgressStore;
  readonly onOpenAcademy: () => void;
}

export type AtlasSort = "name" | "population" | "area";

interface AtlasState {
  query: string;
  continent: Continent | null;
  sort: AtlasSort;
  scrollTop: number;
}

// Kept for the page's lifetime so Back from a profile lands on the same filtered view.
const remembered: AtlasState = { query: "", continent: null, sort: "name", scrollTop: 0 };

/** Test hook: forget the remembered filters. */
export function resetAtlasState(): void {
  Object.assign(remembered, { query: "", continent: null, sort: "name", scrollTop: 0 } satisfies AtlasState);
}

const SORT_LABELS: Readonly<Record<AtlasSort, string>> = { name: "A–Z", population: "Population", area: "Area" };

const MASTERY_LABELS: Readonly<Record<MasteryLevel, string>> = {
  new: "Not started in the Academy",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered",
};

function sortProfiles(profiles: readonly CountryProfile[], sort: AtlasSort): CountryProfile[] {
  const byName = (a: CountryProfile, b: CountryProfile) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const list = [...profiles];
  if (sort === "population") return list.sort((a, b) => (b.populationMillions ?? -1) - (a.populationMillions ?? -1) || byName(a, b));
  if (sort === "area") return list.sort((a, b) => b.areaKm2 - a.areaKm2 || byName(a, b));
  return list.sort(byName);
}

/** The countries a query/filter shows, in display order (pure; used by tests too). */
export function filterAtlas(profiles: readonly CountryProfile[], entries: ReturnType<typeof buildSearchEntries>, state: Pick<AtlasState, "query" | "continent" | "sort">): CountryProfile[] {
  const inContinent = state.continent ? profiles.filter((p) => p.continent === state.continent) : profiles;
  if (!normalizeSearch(state.query)) return sortProfiles(inContinent, state.sort);
  const codes = new Set(inContinent.map((p) => p.code));
  // Search results keep their relevance order unless the player picked a sort.
  const matches = searchCountries(entries, state.query, profiles.length).map((m) => m.profile).filter((p) => codes.has(p.code));
  return state.sort === "name" ? matches : sortProfiles(matches, state.sort);
}

export function createAtlasScreen(options: AtlasScreenOptions): Screen {
  const { shell } = options;
  const previousTitle = document.title;
  document.title = "Atlas · Locato";
  const profiles = allCountryProfiles();
  const entries = buildSearchEntries(profiles, options.countryIndex);
  const state: AtlasState = { ...remembered };
  const controller = new AbortController();
  const { signal } = controller;

  // ---------- Toolbar ----------
  const input = el("input", {
    className: "atlas-search-input",
    attrs: {
      id: "atlas-search",
      type: "search",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      placeholder: "Search by country, capital or code",
      "aria-controls": "atlas-grid",
      "aria-describedby": "atlas-count",
    },
  });
  input.value = state.query;
  const search = el("div", {
    className: "atlas-search",
    children: [
      el("label", { className: "atlas-sr-only", text: "Search countries", attrs: { for: "atlas-search" } }),
      profileIcon("search", "atlas-search-icon"),
      input,
    ],
  });

  const continentCounts = new Map<Continent, number>(CONTINENTS.map((c) => [c, profiles.filter((p) => p.continent === c).length]));
  const chipButtons: HTMLButtonElement[] = [];
  const chip = (continent: Continent | null): HTMLButtonElement => {
    const button = el("button", {
      className: "atlas-chip",
      attrs: { type: "button", "aria-pressed": String(state.continent === continent), "data-continent": continent ?? "all" },
      children: [el("span", { text: continent ?? "All" }), el("span", { className: "atlas-chip-count", text: String(continent ? continentCounts.get(continent) ?? 0 : profiles.length) })],
    });
    button.addEventListener("click", () => {
      state.continent = continent;
      for (const other of chipButtons) other.setAttribute("aria-pressed", String(other === button));
      render();
    }, { signal });
    chipButtons.push(button);
    return button;
  };
  const chips = el("div", { className: "atlas-chips", attrs: { role: "group", "aria-label": "Filter by continent" }, children: [chip(null), ...CONTINENTS.map(chip)] });

  const sortSelect = el("select", {
    className: "atlas-sort-select",
    attrs: { id: "atlas-sort" },
    children: (Object.keys(SORT_LABELS) as AtlasSort[]).map((key) => el("option", { text: SORT_LABELS[key], attrs: { value: key } })),
  });
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value as AtlasSort;
    render();
  }, { signal });
  const sort = el("label", { className: "atlas-sort", attrs: { for: "atlas-sort" }, children: [el("span", { text: "Sort" }), sortSelect] });

  const count = el("p", { className: "atlas-count", attrs: { id: "atlas-count", role: "status", "aria-live": "polite" } });
  const toolbar = el("div", {
    className: "atlas-toolbar",
    children: [el("div", { className: "atlas-toolbar-row", children: [search, sort] }), chips],
  });

  // ---------- Grid ----------
  const grid = el("ul", { className: "atlas-grid", attrs: { id: "atlas-grid", "aria-label": "Countries" } });
  const cards = new Map<string, HTMLElement>();
  const pips = new Map<string, HTMLElement>();

  function card(p: CountryProfile): HTMLElement {
    const pip = el("span", { className: "atlas-pip", attrs: { "data-mastery": "new" } });
    pips.set(p.code, pip);
    const meta = state.sort === "population" ? `${formatPopulation(p.populationMillions)} people` : state.sort === "area" ? formatArea(p.areaKm2) : p.capital;
    const button = el("button", {
      className: "atlas-card",
      attrs: { type: "button", "data-code": p.code, "aria-label": `${p.name}, capital ${p.capital}` },
      children: [
        el("span", { className: "atlas-card-flag", children: [el("img", { attrs: { src: p.flagSrc, alt: "", loading: "lazy", decoding: "async", width: "96", height: "64" } })] }),
        el("span", {
          className: "atlas-card-copy",
          children: [el("span", { className: "atlas-card-name", text: p.name }), el("span", { className: "atlas-card-meta", text: meta })],
        }),
        pip,
      ],
    });
    button.addEventListener("click", () => {
      remembered.scrollTop = page.element.scrollTop;
      shell.openCountry(p.code);
    }, { signal });
    return el("li", { children: [button] });
  }

  function renderMastery(progress: AcademyProgress): void {
    for (const [code, pip] of pips) {
      const level = countryMastery(progress, code);
      pip.dataset.mastery = level;
      pip.title = MASTERY_LABELS[level];
      const button = pip.parentElement;
      if (button) button.dataset.mastery = level;
    }
  }

  const empty = el("div", { className: "atlas-empty", attrs: { hidden: "true" } });

  function render(): void {
    Object.assign(remembered, { query: state.query, continent: state.continent, sort: state.sort });
    const shown = filterAtlas(profiles, entries, state);
    cards.clear();
    pips.clear();
    grid.replaceChildren(...shown.map((p) => {
      const item = card(p);
      cards.set(p.code, item);
      return item;
    }));
    const progress = options.progressStore?.get();
    if (progress) renderMastery(progress);
    const scope = state.continent ? ` in ${state.continent}` : "";
    count.textContent = shown.length === profiles.length ? `${profiles.length} countries` : `${shown.length} of ${profiles.length} countries${scope}`;
    empty.hidden = shown.length > 0;
    if (shown.length === 0) {
      const clear = el("button", { className: "shell-btn shell-btn-quiet", text: "Clear search", attrs: { type: "button" } });
      clear.addEventListener("click", () => {
        state.query = "";
        state.continent = null;
        input.value = "";
        for (const other of chipButtons) other.setAttribute("aria-pressed", String(other.dataset.continent === "all"));
        render();
        input.focus();
      });
      empty.replaceChildren(el("p", { className: "atlas-empty-title", text: `No country matches “${state.query.trim()}”${scope}.` }), el("p", { className: "atlas-empty-copy", text: "Try a capital, a nickname like “Holland”, or a two-letter code." }), clear);
    }
  }

  input.addEventListener("input", () => {
    state.query = input.value;
    render();
  }, { signal });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = grid.querySelector<HTMLButtonElement>(".atlas-card");
      if (first && normalizeSearch(input.value)) {
        event.preventDefault();
        first.click();
      }
    }
  }, { signal });

  const page = createSitePage(shell, {
    section: "learn",
    id: "atlas",
    className: "atlas-page",
    title: "Atlas",
    subtitle: "Every one of the 196 countries: its flag, capital and profile, and how well you know it.",
    titleLink: { label: "Academy", onClick: options.onOpenAcademy },
    content: [toolbar, el("div", { className: "atlas-summary", children: [count, legend()] }), grid, empty],
  });

  function legend(): HTMLElement {
    return el("p", {
      className: "atlas-legend",
      attrs: { "aria-label": "Academy mastery key" },
      children: (["learning", "familiar", "mastered"] as const).map((level) =>
        el("span", { children: [el("span", { className: "atlas-pip", attrs: { "data-mastery": level, "aria-hidden": "true" } }), el("span", { text: MASTERY_LABELS[level] })] }),
      ),
    });
  }

  render();
  const unsubscribe = options.progressStore?.subscribe(renderMastery);
  if (remembered.scrollTop) {
    const top = remembered.scrollTop;
    remembered.scrollTop = 0;
    requestAnimationFrame(() => { page.element.scrollTop = top; });
  }

  return {
    element: page.element,
    destroy: () => {
      controller.abort();
      unsubscribe?.();
      page.destroy();
      document.title = previousTitle;
    },
  };
}
