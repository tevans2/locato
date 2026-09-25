// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { streetViewCountryRounds } from "../src/core/streetview";
import type { Screen } from "../src/app/router";

let screen: Screen | undefined;

afterEach(() => {
  screen?.destroy();
  screen = undefined;
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Street View Country frame loading", () => {
  it("keeps the current frame in the only preload slot until it can be shown", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_EMBED_API_KEY", "test-key");
    const { createStreetViewCountryScreen } = await import("../src/ui/screens/StreetViewCountryScreen");
    const round = streetViewCountryRounds[0]!;
    screen = createStreetViewCountryScreen({
      countryIndex: indexCountries(rawCountries),
      onGameModeChange: vi.fn(),
      onHome: vi.fn(),
      onMultiplayer: vi.fn(),
      onDailyChallenge: vi.fn(),
      dailyChallenge: { date: "2026-09-22", round, onComplete: vi.fn() },
    });
    const frames = [...screen.element.querySelectorAll<HTMLIFrameElement>(".streetview-frame")];
    expect(frames).toHaveLength(2);
    expect(frames[1]!.src).toContain(`${round.frames[0]!.lat}%2C${round.frames[0]!.lng}`);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.element.querySelector(".streetview-loader")?.classList.contains("is-active")).toBe(false);
    expect(screen.element.querySelector<HTMLInputElement>("#streetview-guess-input")?.disabled).toBe(false);
    expect([...screen.element.querySelectorAll<HTMLIFrameElement>(".streetview-frame.is-active")][0]!.src).toContain(`${round.frames[0]!.lat}%2C${round.frames[0]!.lng}`);
  });

  it.each(["regular", "daily"])("keeps all three %s frames and the loader layered inside the stage", async (mode) => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_EMBED_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    const style = document.createElement("style");
    style.textContent = readFileSync("src/styles/game.css", "utf8");
    document.head.append(style);
    const { createStreetViewCountryScreen } = await import("../src/ui/screens/StreetViewCountryScreen");
    screen = createStreetViewCountryScreen({
      countryIndex: indexCountries(rawCountries),
      onGameModeChange: vi.fn(),
      onHome: vi.fn(),
      onMultiplayer: vi.fn(),
      onDailyChallenge: vi.fn(),
      ...(mode === "daily" ? { dailyChallenge: { date: "2026-09-25", round: streetViewCountryRounds[0]!, onComplete: vi.fn() } } : {}),
    });
    document.body.append(screen.element);
    const input = screen.element.querySelector<HTMLInputElement>("#streetview-guess-input")!;
    const form = screen.element.querySelector("form")!;
    const loader = screen.element.querySelector<HTMLElement>(".streetview-loader")!;
    const firstFrame = screen.element.querySelector<HTMLIFrameElement>(".streetview-frame.is-buffer")!;
    const location = new URL(firstFrame.src).searchParams.get("location");
    const round = streetViewCountryRounds.find((candidate) => `${candidate.frames[0]!.lat},${candidate.frames[0]!.lng}` === location)!;
    const wrongGuesses = rawCountries.filter((country) => country.code !== round.countryCode).slice(0, 2);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(input.disabled).toBe(true);
      expect(loader.classList.contains("is-active")).toBe(true);
      expect(getComputedStyle(loader).position).toBe("absolute");
      expect(getComputedStyle(loader).zIndex).toBe("4");
      const pending = screen.element.querySelector<HTMLIFrameElement>(".streetview-frame.is-buffer")!;
      pending.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(150);

      const active = screen.element.querySelector<HTMLIFrameElement>(".streetview-frame.is-active")!;
      const frame = round.frames[attempt]!;
      expect(new URL(active.src).searchParams.get("location")).toBe(`${frame.lat},${frame.lng}`);
      expect(getComputedStyle(active).position).toBe("absolute");
      expect(getComputedStyle(active).opacity).toBe("1");
      expect(active.hidden).toBe(false);
      expect(input.disabled).toBe(false);
      expect(loader.classList.contains("is-active")).toBe(false);
      expect(screen.element.querySelector(".stat-value")?.textContent).toBe(`${attempt + 1} / 3`);

      if (attempt < 2) {
        input.value = wrongGuesses[attempt]!.name;
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }
  });
});
