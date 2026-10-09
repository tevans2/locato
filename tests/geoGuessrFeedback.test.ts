// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeoGuessrFeedback } from "../src/ui/components/GeoGuessrFeedback";
import { saveSettings, defaultSettings } from "../src/storage/settings";
const audio = vi.hoisted(() => ({ play: vi.fn(), unlock: vi.fn(), stop: vi.fn() }));
vi.mock("../src/ui/dom/sfx", () => ({ playGeoSound: audio.play, unlockSound: audio.unlock }));
let controller: AbortController;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); controller = new AbortController(); audio.play.mockReturnValue(audio.stop); });
afterEach(() => { controller.abort(); localStorage.clear(); vi.useRealTimers(); });
describe("GeoGuessr presentation lifecycle", () => {
  it("cancels pending sound and finishes the displayed score on navigation", async () => {
    const fx = createGeoGuessrFeedback(controller.signal, localStorage);
    const score = document.createElement("strong");
    fx.play("score", 5000);
    fx.count(score, 5000, String);
    await vi.advanceTimersByTimeAsync(120);
    expect(Number(score.textContent)).toBeLessThan(5000);
    expect(score.getAttribute("aria-label")).toBe("5000 points");
    controller.abort();
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(score.textContent).toBe("5000");
    await vi.advanceTimersByTimeAsync(2000);
    expect(score.textContent).toBe("5000");
    fx.play("finish");
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it("honors the saved reduced-motion setting without changing scoring", () => {
    saveSettings(localStorage, { ...defaultSettings, reducedMotion: true });
    const fx = createGeoGuessrFeedback(controller.signal, localStorage);
    const score = document.createElement("strong");
    fx.count(score, 4321, String);
    expect(score.textContent).toBe("4321");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("unlocks audio on input and removes the gesture handlers on exit", () => {
    createGeoGuessrFeedback(controller.signal, localStorage);
    document.dispatchEvent(new Event("pointerdown"));
    expect(audio.unlock).toHaveBeenCalledOnce();
    controller.abort();
    document.dispatchEvent(new Event("pointerdown"));
    expect(audio.unlock).toHaveBeenCalledOnce();
  });
});
