// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAtlasScreen, resetAtlasState } from "../src/ui/screens/AtlasScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import { emptyProgress, type AcademyProgress } from "../src/core/academy";
import type { AcademyProgressStore } from "../src/app/academyProgress";
import type { ShellContext } from "../src/ui/shell/types";

const countryIndex = indexCountries(rawCountries);

function makeShell(): ShellContext & { readonly openCountry: ReturnType<typeof vi.fn> } {
  return {
    openSection: vi.fn(),
    goHome: vi.fn(),
    goBack: vi.fn(),
    openGame: vi.fn(),
    openGamePicker: vi.fn(),
    openCountry: vi.fn(),
    openLeaderboards: vi.fn(),
    openAccount: vi.fn(),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => false,
  };
}

function store(progress: AcademyProgress): AcademyProgressStore {
  return { get: () => progress, update: () => undefined, subscribe: () => () => undefined, syncWithAccount: async () => undefined, detachAccount: () => undefined };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
  resetAtlasState();
});

function mount(progress: AcademyProgress = emptyProgress()) {
  const shell = makeShell();
  const onOpenAcademy = vi.fn();
  const screen = createAtlasScreen({ shell, countryIndex, progressStore: store(progress), onOpenAcademy });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const codes = () => [...root.querySelectorAll<HTMLElement>(".atlas-card")].map((card) => card.dataset.code);
  const input = root.querySelector<HTMLInputElement>(".atlas-search-input")!;
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  return { shell, onOpenAcademy, root, codes, input, type };
}

describe("Atlas screen", () => {
  it("is a Learn site page listing all 196 countries A–Z", () => {
    const ui = mount();
    expect(ui.root.dataset.shell).toBe("site");
    expect(ui.root.querySelector('.shell-nav-link[aria-current="page"]')?.textContent).toBe("Learn");
    expect(ui.root.querySelector("h1")?.textContent).toBe("Atlas");
    expect(ui.codes()).toHaveLength(196);
    expect(ui.codes()[0]).toBe("AF");
    expect(ui.root.querySelector(".atlas-count")?.textContent).toBe("196 countries");
  });

  it("searches names, aliases, capitals and codes", () => {
    const ui = mount();
    ui.type("japan");
    expect(ui.codes()[0]).toBe("JP");
    ui.type("Holland");
    expect(ui.codes()).toContain("NL");
    ui.type("Nairobi");
    expect(ui.codes()[0]).toBe("KE");
    ui.type("ch");
    expect(ui.codes()[0]).toBe("CH");
    ui.type("zzzz");
    expect(ui.codes()).toHaveLength(0);
    expect(ui.root.querySelector<HTMLElement>(".atlas-empty")?.hidden).toBe(false);
  });

  it("filters by continent and sorts by population or area", () => {
    const ui = mount();
    ui.root.querySelector<HTMLButtonElement>('.atlas-chip[data-continent="Oceania"]')!.click();
    expect(ui.codes().length).toBeGreaterThan(5);
    expect(ui.codes()).toContain("AU");
    expect(ui.codes()).not.toContain("JP");
    expect(ui.root.querySelector('.atlas-chip[data-continent="Oceania"]')?.getAttribute("aria-pressed")).toBe("true");
    const sort = ui.root.querySelector<HTMLSelectElement>(".atlas-sort-select")!;
    sort.value = "area";
    sort.dispatchEvent(new Event("change"));
    expect(ui.codes()[0]).toBe("AU");
    ui.root.querySelector<HTMLButtonElement>('.atlas-chip[data-continent="all"]')!.click();
    sort.value = "population";
    sort.dispatchEvent(new Event("change"));
    expect(ui.codes().slice(0, 2).sort()).toEqual(["CN", "IN"]);
  });

  it("opens a country's profile from its card, or the first match on Enter", () => {
    const ui = mount();
    ui.root.querySelector<HTMLButtonElement>('.atlas-card[data-code="FR"]')!.click();
    expect(ui.shell.openCountry).toHaveBeenCalledWith("FR");
    ui.type("brazil");
    ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ui.shell.openCountry).toHaveBeenLastCalledWith("BR");
  });

  it("links to the Academy and shows each card's mastery", () => {
    const progress: AcademyProgress = { ...emptyProgress(), cards: { "FR:flag": { box: 1, correct: 1, wrong: 0, lastSeenAt: 1, dueAt: 2 } } };
    const ui = mount(progress);
    ui.root.querySelector<HTMLButtonElement>(".shell-heading-link")!.click();
    expect(ui.onOpenAcademy).toHaveBeenCalled();
    expect(ui.root.querySelector<HTMLElement>('.atlas-card[data-code="FR"]')?.dataset.mastery).toBe("learning");
    expect(ui.root.querySelector<HTMLElement>('.atlas-card[data-code="DE"]')?.dataset.mastery).toBe("new");
  });
});
