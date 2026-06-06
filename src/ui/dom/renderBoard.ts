import { CONTINENTS, type Continent, type Country, type CountryId } from "../../core/countries";
import { el } from "./createElement";

export interface BoardView {
  readonly element: HTMLElement;
  readonly rowByCountryId: ReadonlyMap<CountryId, HTMLTableRowElement>;
  readonly continentCountByContinent: ReadonlyMap<Continent, HTMLElement>;
}

function createMiniFlag(country: Country): HTMLElement {
  const image = el("img", { attrs: { src: country.flagSrc, alt: "" } });
  return el("span", { className: "mini-flag", attrs: { "aria-hidden": "true" }, children: [image] });
}

export function createBoardView(countries: readonly Country[]): BoardView {
  const rowByCountryId = new Map<CountryId, HTMLTableRowElement>();
  const continentCountByContinent = new Map<Continent, HTMLElement>();
  const tbody = el("tbody");
  const sortedCountries = [...countries].sort((left, right) => {
    const continentDelta = CONTINENTS.indexOf(left.continent) - CONTINENTS.indexOf(right.continent);
    return continentDelta || left.name.localeCompare(right.name);
  });

  for (const continent of CONTINENTS) {
    const continentCountries = sortedCountries.filter((country) => country.continent === continent);
    if (continentCountries.length === 0) continue;

    const count = el("span", { className: "continent-count", text: `0 / ${continentCountries.length}` });
    continentCountByContinent.set(continent, count);
    tbody.append(
      el("tr", {
        className: "continent-row",
        children: [el("td", { attrs: { colspan: "3" }, children: [document.createTextNode(continent), count] })],
      }),
    );

    for (const country of continentCountries) {
      const row = el("tr", { className: "empty-slot", attrs: { "data-country-id": String(country.id) } });
      row.append(
        el("td", { className: "slot-number", text: String(rowByCountryId.size + 1) }),
        el("td", { attrs: { "aria-label": "Blank country slot" } }),
        el("td", { attrs: { "aria-label": "Blank code slot" } }),
      );
      rowByCountryId.set(country.id, row);
      tbody.append(row);
    }
  }

  const table = el("table", {
    children: [
      el("thead", {
        children: [
          el("tr", {
            children: [
              el("th", { className: "slot-number", text: "#" }),
              el("th", { className: "country-column", text: "Country" }),
              el("th", { className: "code-column", text: "Code" }),
            ],
          }),
        ],
      }),
      tbody,
    ],
  });

  return { element: el("div", { className: "board-scroll", children: [table] }), rowByCountryId, continentCountByContinent };
}

export function revealCountryOnBoard(view: BoardView, country: Country): void {
  const row = view.rowByCountryId.get(country.id);
  if (!row) return;

  row.classList.remove("empty-slot");
  row.classList.add("revealed-slot");
  const nameCell = row.children.item(1);
  const codeCell = row.children.item(2);
  if (nameCell) nameCell.replaceChildren(createMiniFlag(country), document.createTextNode(country.name));
  if (codeCell) codeCell.textContent = country.code;
}

export function resetBoardView(view: BoardView): void {
  for (const row of view.rowByCountryId.values()) {
    row.className = "empty-slot";
    const nameCell = row.children.item(1);
    const codeCell = row.children.item(2);
    if (nameCell) {
      nameCell.textContent = "";
      nameCell.setAttribute("aria-label", "Blank country slot");
    }
    if (codeCell) {
      codeCell.textContent = "";
      codeCell.setAttribute("aria-label", "Blank code slot");
    }
  }
}


export function updateContinentCounts(view: BoardView, countries: readonly Country[], guessedCountryIds: ReadonlySet<CountryId>): void {
  for (const continent of CONTINENTS) {
    const count = view.continentCountByContinent.get(continent);
    if (!count) continue;
    const total = countries.filter((country) => country.continent === continent).length;
    const guessed = countries.filter((country) => country.continent === continent && guessedCountryIds.has(country.id)).length;
    count.textContent = `${guessed} / ${total}`;
  }
}
