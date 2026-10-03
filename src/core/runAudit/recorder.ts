import type { RunEntry, RunTimeline } from "./index";

/**
 * Records a run's timeline in the browser: each country found, when, and how the answer box was
 * typed into since the previous one. Input is counted in the capture phase on `root`, so the
 * keystroke that completes a country is counted before the game's own handler accepts it.
 */
export interface RunRecorder {
  /** A country was found `t` ms into the run. */
  readonly mark: (code: string, t: number) => void;
  readonly timeline: () => RunTimeline;
  readonly size: () => number;
  /** Start over for a new run. */
  readonly reset: () => void;
}

export function createRunRecorder(options: { readonly root: HTMLElement; readonly signal: AbortSignal; readonly now?: () => number }): RunRecorder {
  const now = options.now ?? (() => Date.now());
  let entries: RunEntry[] = [];
  let keys = 0;
  let synthetic = 0;
  let pastes = 0;
  let hiddenMs = 0;
  let hiddenSince: number | null = null;

  function isAnswerBox(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement && target.type === "text";
  }

  options.root.addEventListener("input", (event) => {
    if (!isAnswerBox(event.target)) return;
    // The browser marks real typing (keyboards, on-screen keyboards, autocorrect) as trusted.
    // Events a page script dispatches never are, whatever it does.
    if (event.isTrusted) keys += 1;
    else synthetic += 1;
  }, { capture: true, signal: options.signal });
  options.root.addEventListener("paste", (event) => {
    if (isAnswerBox(event.target)) pastes += 1;
  }, { capture: true, signal: options.signal });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenSince ??= now();
      else if (hiddenSince !== null) {
        hiddenMs += now() - hiddenSince;
        hiddenSince = null;
      }
    }, { signal: options.signal });
  }

  return {
    mark: (code, t) => {
      entries.push([code, Math.max(0, Math.round(t)), keys, synthetic]);
      keys = 0;
      synthetic = 0;
    },
    timeline: () => ({
      entries: [...entries],
      signals: { pastes, hiddenMs: hiddenMs + (hiddenSince !== null ? now() - hiddenSince : 0) },
    }),
    size: () => entries.length,
    reset: () => {
      entries = [];
      keys = 0;
      synthetic = 0;
      pastes = 0;
      hiddenMs = 0;
      hiddenSince = typeof document !== "undefined" && document.visibilityState === "hidden" ? now() : null;
    },
  };
}
