// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeoGuessrScreen } from "../src/ui/screens/GeoGuessrScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
const audio = vi.hoisted(() => ({ play: vi.fn(() => () => {}), unlock: vi.fn() }));
vi.mock("../src/ui/dom/sfx", () => ({ playGeoSound: audio.play, unlockSound: audio.unlock, isSoundEnabled: () => true, setSoundEnabled() {}, SOUND_CHANGE_EVENT: "test:sound" }));
const locations = Array.from({ length: 5 }, () => ({ lat: 42, lng: 12, heading: 0, countryCode: "IT", label: "Round" }));
let screen: ReturnType<typeof createGeoGuessrScreen>;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { screen?.destroy(); document.body.replaceChildren(); localStorage.clear(); vi.useRealTimers(); });
async function setup() {
  let ready!: (p: { lat: number; lng: number }) => void;
  const accepting = vi.fn();
  screen = createGeoGuessrScreen({ countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {} }, {
    createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses: accepting }),
    createPanorama: () => ({ element: document.createElement("div"), show: () => new Promise(resolve => { ready = resolve; }), reset() {}, destroy() {} }),
    loadLocations: async () => locations,
  });
  document.body.append(screen.element);
  screen.element.querySelector<HTMLButtonElement>(".geo-start-map")!.click();
  await vi.advanceTimersByTimeAsync(0);
  return { ready: () => ready({ lat: 42, lng: 12 }), accepting, number: () => screen.element.querySelector(".geo-journey-countdown strong")?.textContent };
}
describe("round readiness and countdown", () => {
  it("keeps the globe up until ready, then counts three full seconds before accepting guesses", async () => {
    const ui = await setup();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.element.dataset.phase).toBe("loading");
    expect(ui.number()).toBeUndefined();
    expect(audio.play).not.toHaveBeenCalled();
    ui.ready(); await vi.advanceTimersByTimeAsync(0);
    expect(ui.number()).toBe("3");
    await vi.advanceTimersByTimeAsync(999);
    expect(ui.number()).toBe("3");
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.number()).toBe("2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.number()).toBe("1");
    await vi.advanceTimersByTimeAsync(999);
    expect(screen.element.dataset.phase).toBe("loading");
    expect(ui.accepting).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.element.dataset.phase).toBe("playing");
    expect(ui.accepting).toHaveBeenLastCalledWith(true);
    expect(ui.number()).toBe("GO");
    expect(audio.play.mock.calls).toEqual([["countdown", 3], ["countdown", 2], ["countdown", 1], ["go", undefined]]);
  });
  it("cancels countdown ticks and never starts a round after leaving", async () => {
    const ui = await setup();
    ui.ready(); await vi.advanceTimersByTimeAsync(0);
    screen.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(ui.accepting).not.toHaveBeenCalledWith(true);
    expect(screen.element.dataset.phase).toBe("loading");
  });
});
