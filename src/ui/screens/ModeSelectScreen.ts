import { CONTINENTS, type Continent } from "../../core/countries";
import { selectableModes, type GameModeId } from "../../core/modes";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface ModeSelectScreenOptions {
  readonly onBack: () => void;
  readonly onSelect: (modeId: GameModeId, continent?: Continent) => void;
}

export function createModeSelectScreen(options: ModeSelectScreenOptions): Screen {
  let selectedContinent: Continent = "Africa";
  const continentSelect = el("select", {
    className: "continent-select",
    children: CONTINENTS.map((continent) => el("option", { text: continent, attrs: { value: continent } })),
    on: {
      change: (event) => {
        selectedContinent = (event.target as HTMLSelectElement).value as Continent;
      },
    },
  });

  const modeCards = selectableModes.map((mode) => {
    const start = el("button", {
      className: "secondary-action",
      text: mode.id === "continent" ? "Start continent" : "Start mode",
      on: {
        click: () => options.onSelect(mode.id as GameModeId, mode.id === "continent" ? selectedContinent : undefined),
      },
    });

    const children: Node[] = [el("h2", { text: mode.label }), el("p", { text: mode.description })];
    if (mode.id === "continent") children.push(continentSelect);
    children.push(start);

    return el("article", { className: "mode-card", children });
  });

  const element = el("section", {
    className: "mode-screen",
    children: [
      el("button", { className: "ghost-action", text: "← Home", on: { click: options.onBack } }),
      el("div", { className: "screen-heading", children: [el("p", { className: "eyebrow", text: "Choose rules" }), el("h1", { text: "Game modes" })] }),
      el("div", { className: "mode-grid", children: modeCards }),
    ],
  });

  return { element, destroy: () => undefined };
}
