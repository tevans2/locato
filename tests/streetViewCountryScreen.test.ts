// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { streetViewCountryRounds } from "../src/core/streetview";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Street View Country frame loading", () => {
  it("keeps the current frame in the only preload slot until it can be shown", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_GOOGLE_MAPS_EMBED_API_KEY", "test-key");
    const { createStreetViewCountryScreen } = await import("../src/ui/screens/StreetViewCountryScreen");
    const round = streetViewCountryRounds[0]!;
    const screen = createStreetViewCountryScreen({
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
    expect(screen.element.querySelector(".streetview-loader")?.classList.contains("is-visible")).toBe(false);
    expect(screen.element.querySelector<HTMLInputElement>("#streetview-guess-input")?.disabled).toBe(false);
    expect([...screen.element.querySelectorAll<HTMLIFrameElement>(".streetview-frame.is-active")][0]!.src).toContain(`${round.frames[0]!.lat}%2C${round.frames[0]!.lng}`);
    screen.destroy();
  });
});
