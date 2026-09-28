// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCountryProfileScreen, type CountryProfileScreenOptions } from "../src/ui/screens/CountryProfileScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import { emptyProgress, type AcademyProgress, type CardProgress } from "../src/core/academy";
import type { AcademyProgressStore } from "../src/app/academyProgress";
import type { WorldCountryFeature } from "../src/core/map";
import { areaComparison, formatLatLng } from "../src/ui/components/academy/profileFacts";
import { countryFrame } from "../src/ui/components/academy/profileLocator";

const countryIndex = indexCountries(rawCountries);

function square(code: string, lng: number, lat: number, size = 2): WorldCountryFeature {
  return {
    name: code,
    code,
    continent: "Europe",
    geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] },
  };
}

const features: readonly WorldCountryFeature[] = [
  square("CH", 6, 46), square("DE", 6, 48, 4), square("FR", 0, 44, 5), square("IT", 8, 40, 5), square("AT", 10, 46), square("LI", 9.5, 47, 0.3), square("JP", 135, 34, 4),
];

function fakeStore(initial: AcademyProgress = emptyProgress()): AcademyProgressStore & { set: (p: AcademyProgress) => void } {
  let progress = initial;
  const listeners = new Set<(p: AcademyProgress) => void>();
  return {
    get: () => progress,
    update: (change) => { progress = change(progress); listeners.forEach((l) => l(progress)); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    syncWithAccount: async () => undefined,
    detachAccount: () => undefined,
    set: (p) => { progress = p; listeners.forEach((l) => l(progress)); },
  };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(code: string, overrides: Partial<CountryProfileScreenOptions> = {}) {
  const callbacks = { onBack: vi.fn(), onHome: vi.fn(), onOpenCountry: vi.fn(), onStartLesson: vi.fn(), onOpenAcademy: vi.fn() };
  const screen = createCountryProfileScreen({ countryIndex, worldCountryFeatures: features, progressStore: fakeStore(), code, ...callbacks, ...overrides });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const q = <T extends Element = HTMLElement>(selector: string) => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const fact = (key: string) => q(`[data-fact="${key}"]`).textContent ?? "";
  return { screen, root, q, fact, ...callbacks };
}

function card(box: CardProgress["box"]): CardProgress {
  return { box, correct: box, wrong: 0, lastSeenAt: 1, dueAt: 2 };
}

describe("Country profile screen", () => {
  it("renders the key facts for a known country and manages the document title", () => {
    document.title = "Locato";
    const ui = mount("JP");
    expect(document.title).toBe("Japan · Locato");
    expect(ui.q("h1").textContent).toBe("Japan");
    expect(ui.q(".cp-kicker").textContent).toContain("Eastern Asia");
    expect(ui.fact("capital")).toContain("Tokyo");
    expect(ui.fact("population")).toContain("124 million");
    expect(ui.fact("population")).toContain("12th most populous of 196");
    expect(ui.fact("area")).toContain("377,930 km²");
    expect(ui.fact("currency")).toContain("Japanese yen");
    expect(ui.fact("currency")).toContain("¥");
    expect(ui.fact("calling")).toContain("+81");
    expect(ui.fact("driving")).toContain("Left");
    expect(ui.fact("highest")).toContain("Mount Fuji");
    expect(ui.q(".cp-flag").getAttribute("alt")).toBe("Flag of Japan");
    expect(ui.q(".cp-neighbours").textContent).toContain("No land borders");
    expect(ui.root.querySelectorAll(".cp-funfact-list li").length).toBeGreaterThanOrEqual(2);
    expect(ui.root.querySelector(".cp-memory-card.is-shape")?.textContent).toContain("islands");
    // Capital marker is drawn on the map.
    expect(ui.root.querySelector(".cp-map-capital-label")?.textContent).toBe("Tokyo");
    expect(ui.root.querySelector(".world-map-country.is-cp-self")).not.toBeNull();
    ui.screen.destroy();
    screens.length = 0;
    expect(document.title).toBe("Locato");
  });

  it("shows a friendly not-found state with a working search picker", () => {
    const ui = mount("ZZ");
    expect(ui.root.classList.contains("is-not-found")).toBe(true);
    expect(document.title).toBe("Country not found · Locato");
    expect(ui.q("h1").textContent).toContain("isn’t in our atlas");
    const input = ui.q<HTMLInputElement>(".cp-notfound .cp-search-input");
    input.value = "holland";
    input.dispatchEvent(new Event("input"));
    const option = ui.q(".cp-notfound .cp-search-option");
    expect(option.textContent).toContain("Netherlands");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ui.onOpenCountry).toHaveBeenCalledWith("NL");
  });

  it("finds countries by capital in the atlas search", () => {
    const ui = mount("JP");
    const input = ui.q<HTMLInputElement>(".cp-atlasbar .cp-search-input");
    input.value = "nairobi";
    input.dispatchEvent(new Event("input"));
    expect(ui.q(".cp-search-option").dataset.code).toBe("KE");
    expect(ui.q(".cp-search-option").textContent).toContain("Capital");
  });

  it("opens neighbours from the chip strip and the map", () => {
    const ui = mount("CH");
    const chips = [...ui.root.querySelectorAll<HTMLButtonElement>(".cp-neighbour-chip")];
    expect(chips.map((chip) => chip.dataset.code)).toEqual(["AT", "FR", "DE", "IT", "LI"]);
    chips[0]!.click();
    expect(ui.onOpenCountry).toHaveBeenCalledWith("AT");
    const germany = countryIndex.byCode.get("DE")!;
    const path = ui.q<SVGPathElement>(`.world-map-country[data-country-id="${germany.id}"]`);
    expect(path.classList.contains("is-cp-neighbour")).toBe(true);
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ui.onOpenCountry).toHaveBeenLastCalledWith("DE");
  });

  it("links lookalikes, drills them and hands off to the Academy group", () => {
    const ui = mount("CH");
    const capitalCard = ui.q(".cp-look-card[data-skill='capital']");
    expect(capitalCard.textContent).toContain("Bern");
    expect(capitalCard.textContent).toContain("Berlin");
    ui.q<HTMLButtonElement>(".cp-look-item[data-code='DE']").click();
    expect(ui.onOpenCountry).toHaveBeenCalledWith("DE");
    ui.q<HTMLButtonElement>(".cp-drill").click();
    expect(ui.onStartLesson).toHaveBeenCalledWith("lookalikes:CH");
    ui.q<HTMLButtonElement>("[data-action='practise']").click();
    expect(ui.onStartLesson).toHaveBeenLastCalledWith("alps-low-countries");
    ui.q<HTMLButtonElement>("[data-action='open-group']").click();
    expect(ui.onOpenAcademy).toHaveBeenCalledWith("alps-low-countries");
  });

  it("browses alphabetically with buttons and the arrow keys", () => {
    const ui = mount("JP");
    ui.q<HTMLButtonElement>(".cp-browse-link.is-prev").click();
    expect(ui.onOpenCountry).toHaveBeenLastCalledWith("JM");
    ui.q<HTMLButtonElement>(".cp-step-next").click();
    expect(ui.onOpenCountry).toHaveBeenLastCalledWith("JO");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(ui.onOpenCountry).toHaveBeenLastCalledWith("JM");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.onOpenCountry).toHaveBeenLastCalledWith("JO");
    // Arrow keys inside the search box move the caret, not the page.
    const calls = ui.onOpenCountry.mock.calls.length;
    ui.q<HTMLInputElement>(".cp-search-input").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(ui.onOpenCountry.mock.calls.length).toBe(calls);
    ui.screen.destroy();
    screens.length = 0;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.onOpenCountry.mock.calls.length).toBe(calls);
  });

  it("shows the player's mastery pips and updates when progress changes", () => {
    const store = fakeStore();
    const ui = mount("JP", { progressStore: store });
    expect(ui.q(".cp-mastery").textContent).toContain("haven’t studied Japan");
    store.set({ ...emptyProgress(), cards: { "JP:flag": card(3), "JP:shape": card(1), "JP:capital": card(2), "JP:map": card(2) } });
    const skills = [...ui.root.querySelectorAll(".cp-skill")].map((li) => li.getAttribute("aria-label"));
    expect(skills).toEqual(["Flag: 3 of 5", "Outline: 1 of 5", "Capital: 2 of 5", "On the map: 2 of 5"]);
    expect(ui.q(".cp-level").textContent).toBe("Learning");
  });
});

describe("profile helpers", () => {
  it("phrases area comparisons and coordinates", () => {
    expect(areaComparison(0.44, "VA")).toBe("About 62 football pitches");
    expect(areaComparison(242_495, "GB")).toBe("About 12× the size of Wales");
    expect(areaComparison(377_930, "JP")).toBe("About half the size of Texas");
    expect(formatLatLng([-25.75, 28.19])).toBe("25.8°S 28.2°E");
  });

  it("frames the home landmass rather than far-flung territory", () => {
    const home = square("FR", 0, 44, 5);
    const farAway: WorldCountryFeature = {
      ...home,
      geometry: { type: "MultiPolygon", coordinates: [home.geometry.coordinates as never, [[[-54, 3], [-52, 3], [-52, 5], [-54, 5], [-54, 3]]]] },
    };
    const frame = countryFrame(farAway, [48.85, 2.35])!;
    expect(frame.width).toBeLessThan(20);
  });
});
