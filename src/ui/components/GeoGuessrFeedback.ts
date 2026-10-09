import { readSettings } from "../../storage/settings";
import { playGeoSound, unlockSound, type GeoSoundCue } from "../dom/sfx";

/** Presentation only: scoring and navigation never wait for a sound or animation. */
export function createGeoGuessrFeedback(signal: AbortSignal, storage: Storage | null) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sounds = new Set<() => void>();
  let frame = 0;
  let finishCount: (() => void) | null = null;
  let cleanupTimer = 0;
  function reducedMotion(): boolean {
    try { return motion.matches || Boolean(storage && readSettings(storage).reducedMotion); }
    catch { return motion.matches; }
  }
  function reset(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    finishCount?.();
    finishCount = null;
    window.clearTimeout(cleanupTimer);
    sounds.forEach(stop => stop());
    sounds.clear();
  }
  document.addEventListener("pointerdown", unlockSound, { signal, capture: true, passive: true });
  document.addEventListener("keydown", unlockSound, { signal, capture: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); }, { signal });
  motion.addEventListener("change", () => { if (motion.matches) { finishCount?.(); finishCount = null; cancelAnimationFrame(frame); } }, { signal });
  signal.addEventListener("abort", reset, { once: true });
  return {
    reducedMotion,
    reset,
    play(cue: GeoSoundCue, score?: number): void {
      if (signal.aborted || document.hidden) return;
      sounds.add(playGeoSound(cue, score));
      window.clearTimeout(cleanupTimer);
      cleanupTimer = window.setTimeout(() => { sounds.forEach(stop => stop()); sounds.clear(); }, 1500);
    },
    count(element: HTMLElement, value: number, format: (value: number) => string): void {
      cancelAnimationFrame(frame);
      finishCount?.();
      finishCount = () => { element.textContent = format(value); };
      // Expose the actual result immediately to assistive technology.
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", `${format(value)} points`);
      if (reducedMotion() || signal.aborted || document.hidden) { finishCount(); finishCount = null; return; }
      let start: number | null = null;
      const tick = (time: number): void => {
        start ??= time;
        const progress = Math.min(1, (time - start) / 850);
        element.textContent = format(Math.round(value * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
        else { frame = 0; finishCount = null; }
      };
      frame = requestAnimationFrame(tick);
    },
  };
}
