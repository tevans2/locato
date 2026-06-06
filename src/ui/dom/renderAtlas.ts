import { CONTINENTS, type Continent, type Country, type CountryId } from "../../core/countries";
import { el } from "./createElement";

interface ContinentProgressView {
  readonly count: HTMLElement;
  readonly fill: HTMLElement;
}

export interface AtlasView {
  readonly element: HTMLElement;
  readonly openButton: HTMLButtonElement;
  readonly closeButton: HTMLButtonElement;
  readonly overlay: HTMLElement;
  readonly drawer: HTMLElement;
  readonly progressByContinent: ReadonlyMap<Continent, ContinentProgressView>;
  readonly revealedList: HTMLElement;
}

function createProgressRow(continent: Continent, total: number): { row: HTMLElement; view: ContinentProgressView } {
  const count = el("span", { className: "atlas-progress-count", text: `0 / ${total}` });
  const fill = el("span", { className: "atlas-progress-fill" });
  const row = el("article", {
    className: "atlas-progress-row",
    children: [
      el("div", { className: "atlas-progress-copy", children: [el("strong", { text: continent }), count] }),
      el("div", { className: "atlas-progress-track", children: [fill] }),
    ],
  });

  return { row, view: { count, fill } };
}

function groupCountriesByContinent(countries: readonly Country[]): Map<Continent, Country[]> {
  const grouped = new Map<Continent, Country[]>();
  for (const continent of CONTINENTS) grouped.set(continent, []);

  for (const country of countries) {
    grouped.get(country.continent)?.push(country);
  }

  for (const group of grouped.values()) group.sort((left, right) => left.name.localeCompare(right.name));
  return grouped;
}

export function createAtlasView(countries: readonly Country[]): AtlasView {
  const grouped = groupCountriesByContinent(countries);
  const progressByContinent = new Map<Continent, ContinentProgressView>();
  const progressRows: HTMLElement[] = [];

  for (const continent of CONTINENTS) {
    const total = grouped.get(continent)?.length ?? 0;
    if (total === 0) continue;
    const { row, view } = createProgressRow(continent, total);
    progressByContinent.set(continent, view);
    progressRows.push(row);
  }

  const openButton = el("button", { className: "atlas-open", text: "Atlas", attrs: { type: "button", "aria-expanded": "false" } });
  const closeButton = el("button", { className: "atlas-close", text: "Close", attrs: { type: "button" } });
  const revealedList = el("div", { className: "atlas-revealed-list" });
  const overlay = el("div", { className: "atlas-overlay", attrs: { "aria-hidden": "true" } });
  const drawer = el("aside", {
    className: "atlas-drawer",
    attrs: { "aria-label": "Atlas progress", tabindex: "-1" },
    children: [
      el("header", { className: "atlas-header", children: [el("div", { children: [el("p", { className: "eyebrow", text: "Progress" }), el("h2", { text: "Atlas" })] }), closeButton] }),
      el("section", { className: "atlas-section", children: [el("h3", { text: "Continents" }), el("div", { className: "atlas-progress", children: progressRows })] }),
      el("section", { className: "atlas-section", children: [el("h3", { text: "Revealed" }), revealedList] }),
    ],
  });
  overlay.hidden = true;
  drawer.hidden = true;
  const element = el("div", { className: "atlas-shell", children: [openButton, overlay, drawer] });

  return { element, openButton, closeButton, overlay, drawer, progressByContinent, revealedList };
}

export function setAtlasOpen(view: AtlasView, open: boolean): void {
  view.element.classList.toggle("open", open);
  view.openButton.setAttribute("aria-expanded", String(open));
  view.overlay.setAttribute("aria-hidden", String(!open));
  view.overlay.hidden = !open;
  view.drawer.hidden = !open;
  if (open) view.drawer.focus();
}

export function updateAtlasView(view: AtlasView, countries: readonly Country[], guessedCountryIds: ReadonlySet<CountryId>): void {
  const grouped = groupCountriesByContinent(countries);
  const revealedGroups: HTMLElement[] = [];

  for (const continent of CONTINENTS) {
    const continentCountries = grouped.get(continent) ?? [];
    if (continentCountries.length === 0) continue;

    const guessedCountries = continentCountries.filter((country) => guessedCountryIds.has(country.id));
    const progress = continentCountries.length === 0 ? 0 : guessedCountries.length / continentCountries.length;
    const progressView = view.progressByContinent.get(continent);
    if (progressView) {
      progressView.count.textContent = `${guessedCountries.length} / ${continentCountries.length}`;
      progressView.fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    }

    if (guessedCountries.length > 0) {
      revealedGroups.push(
        el("section", {
          className: "atlas-revealed-group",
          children: [
            el("h4", { text: continent }),
            el("div", { className: "atlas-chip-list", children: guessedCountries.map((country) => el("span", { className: "atlas-chip", text: country.name })) }),
          ],
        }),
      );
    }
  }

  view.revealedList.replaceChildren(...(revealedGroups.length > 0 ? revealedGroups : [el("p", { className: "atlas-empty", text: "No places revealed yet." })]));
}
