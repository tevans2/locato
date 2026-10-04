// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createLandingScreen } from "../src/ui/screens/LandingScreen";
import type { ShellContext } from "../src/ui/shell/types";
import type { AtlasHover } from "../src/ui/components/landing/renderAtlasGlobe";

const globeMock = vi.hoisted(() => ({
  reset: vi.fn(), selectCountry: vi.fn(), destroy: vi.fn(),
  create: vi.fn(), load: vi.fn(),
}));
vi.mock("../src/core/map", () => ({ loadWorldCountryFeatures: globeMock.load }));
vi.mock("../src/ui/components/landing/renderAtlasGlobe", () => ({ createAtlasGlobe: globeMock.create }));

const countryIndex = indexCountries(rawCountries);
const screens: ReturnType<typeof createLandingScreen>[] = [];
const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: (key) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index) => [...values.keys()][index] ?? null,
};
function shell(): ShellContext {
  return { openSection: vi.fn(), goHome: vi.fn(), goBack: vi.fn(), openGame: vi.fn(), openGamePicker: vi.fn(), openCountry: vi.fn(), openLeaderboards: vi.fn(), openAccount: vi.fn(), controls: document.createElement("div"), confirmLeave: vi.fn(async () => true), signedIn: () => false };
}
async function mount() {
  const navigation = shell();
  let screen!: ReturnType<typeof createLandingScreen>;
  await act(async () => {
    screen = createLandingScreen({ shell: navigation, countryIndex, storage });
    screens.push(screen);
    document.body.append(screen.element);
  });
  return { screen, navigation };
}
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.clear();
  globeMock.load.mockResolvedValue([]);
  globeMock.create.mockImplementation((_host, _features, options: { onHover: (hover: AtlasHover) => void }) => {
    options.onHover({ country: countryIndex.byCode.get("ZA")!, x: 300, y: 380, visible: true });
    return globeMock;
  });
});
afterEach(async () => {
  await act(async () => { screens.splice(0).forEach((screen) => screen.destroy()); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Landing globe and game launcher", () => {
  it("shows a sourced daily fact, opens its profile, and updates an open page at UTC midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-04T23:59:59Z"));
    globeMock.create.mockImplementation((_host, _features, options: { featuredCountryCode: string; onHover: (hover: AtlasHover) => void }) => {
      options.onHover({ country: countryIndex.byCode.get(options.featuredCountryCode)!, x: 180, y: 200, visible: true });
      return globeMock;
    });
    const { navigation } = await mount();
    expect(globeMock.create.mock.calls[0]![2].featuredCountryCode).toBe("BW");
    const card = document.querySelector('[data-testid="atlas-daily-card"]')!;
    expect(card.textContent).toContain("Okavango Delta floods during the dry season");
    expect(card.querySelector("a")?.href).toBe("https://whc.unesco.org/en/list/1432/");
    await click('[aria-label="Explore Botswana"]');
    expect(navigation.openCountry).toHaveBeenCalledWith("BW");
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(document.querySelector('[data-testid="atlas-daily-card"]')?.textContent).toContain("Yakushima");
    expect(document.querySelector(".atlas-heading-actions time")?.getAttribute("datetime")).toBe("2026-10-05");
    expect(globeMock.destroy).toHaveBeenCalledOnce();
    expect(globeMock.create.mock.calls[1]![2].featuredCountryCode).toBe("JP");
  });

  it("opens real country profiles from the hover card and disposes the globe on exit", async () => {
    const { navigation, screen } = await mount();
    expect(document.querySelector('[data-testid="atlas-country-card"]')?.textContent).toContain("Capital · Pretoria");
    await click('[aria-label="Explore South Africa"]');
    expect(navigation.openCountry).toHaveBeenCalledWith("ZA");
    await click('[aria-label="Reset globe view"]');
    expect(globeMock.reset).toHaveBeenCalledOnce();
    await act(async () => screen.destroy());
    screens.splice(screens.indexOf(screen), 1);
    expect(globeMock.destroy).toHaveBeenCalledOnce();
  });

  it("opens games directly from the original tiles without adding a launch button", async () => {
    const { navigation } = await mount();
    await click('[data-testid="picker-mode-capitals"]');
    expect(document.querySelector('[data-testid="button-play-selected"]')).toBeNull();
    expect(navigation.openGame).toHaveBeenCalledWith("capitals", "practice");
    expect(globeMock.create).toHaveBeenCalledOnce();
    await click('.mode-picker-tabs button:nth-child(2)');
    expect(navigation.openGame).toHaveBeenCalledTimes(1);
    await click('[data-testid="picker-mode-name-all"]');
    expect(navigation.openGame).toHaveBeenLastCalledWith("name-all", "practice");
  });

  it("leaves games and country exploration usable when the globe fails, and permits retry", async () => {
    globeMock.load.mockRejectedValueOnce(new Error("Offline"));
    const { navigation } = await mount();
    expect(document.querySelector('.atlas-keyboard-picker')?.classList.contains("is-visible")).toBe(true);
    expect(document.querySelector('[data-testid="atlas-daily-card"] a')).not.toBeNull();
    const picker = document.querySelector<HTMLSelectElement>('#atlas-country-picker')!;
    await act(async () => { picker.value = "JP"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(navigation.openCountry).toHaveBeenCalledWith("JP");
    await click('[data-testid="picker-mode-flags"]');
    expect(navigation.openGame).toHaveBeenCalledWith("flags", "practice");
    await click('.atlas-interaction-hint button');
    expect(globeMock.create).toHaveBeenCalledOnce();
    expect(document.querySelector('.atlas-keyboard-picker')?.classList.contains("is-visible")).toBe(false);
  });

  it("does not initialize a renderer after leaving during a slow map download", async () => {
    let resolve!: (features: readonly never[]) => void;
    globeMock.load.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { screen } = await mount();
    await act(async () => screen.destroy());
    screens.splice(screens.indexOf(screen), 1);
    await act(async () => resolve([]));
    expect(globeMock.create).not.toHaveBeenCalled();
  });
});
