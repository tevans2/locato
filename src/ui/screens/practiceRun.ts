import { el } from "../dom/createElement";
import { createFocusBar, type FocusBarHandle } from "../shell/FocusBar";
import { createGameBar, type GameBarHandle, type GameBarMenuItem } from "../shell/GameBar";
import type { ResultsCardHandle } from "../shell/ResultsCard";
import { markShellScreen, type ShellContext } from "../shell/types";
import type { GameModeId } from "../../core/gameModes";
import "../../styles/practice-run.css";

/**
 * Shared pieces for the map and Street View practice modes (MapTap, Worldsplit, GeoGuessr,
 * Street View country): the GameBar / daily FocusBar, a fixed-length practice run's leave
 * guard, local bests and the results stage that holds the shell's results card.
 */

/** Scores are always shown with en-US grouping ("25,000") so copy and tests don't vary by machine locale. */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatKm(distanceKm: number): string {
  if (distanceKm < 1) return `${formatNumber(distanceKm * 1000)} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${formatNumber(distanceKm)} km`;
}

/**
 * Screens are always handed a ShellContext by App; tests and legacy callers may not pass one.
 * The fallback keeps the bar and results card working, routing every "leave" to `onHome`.
 */
export function shellOrFallback(shell: ShellContext | undefined, onHome: () => void): ShellContext {
  if (shell) return shell;
  return {
    openSection: () => onHome(),
    goHome: onHome,
    goBack: () => onHome(),
    openGame: () => undefined,
    openGamePicker: () => undefined,
    openCountry: () => undefined,
    openCompete: () => undefined,
    openAccount: () => undefined,
    controls: document.createElement("div"),
    confirmLeave: async () => true,
    signedIn: () => false,
  };
}

export interface PracticeBarOptions {
  readonly gameMode: GameModeId;
  readonly extraMenuItems?: readonly GameBarMenuItem[];
  /** Returns a message while a run is in progress so leaving asks first. */
  readonly leaveGuard?: () => string | null;
  readonly onHowToPlay?: () => void;
}

/** GameBar for a practice-only mode (these modes have no leaderboard). Marks `root` as a game screen. */
export function createPracticeBar(root: HTMLElement, shell: ShellContext, options: PracticeBarOptions): GameBarHandle {
  markShellScreen(root, "game");
  return createGameBar(shell, {
    gameMode: options.gameMode,
    run: "practice",
    onBack: () => shell.goBack("play"),
    backLabel: "Back",
    ...(options.onHowToPlay ? { onHowToPlay: options.onHowToPlay } : {}),
    ...(options.extraMenuItems ? { extraMenuItems: options.extraMenuItems } : {}),
    ...(options.leaveGuard ? { leaveGuard: options.leaveGuard } : {}),
  });
}

/** Where a daily stage sits inside today's 10-round challenge. */
export interface DailyStageProgress {
  /** 1-based round number within the whole daily. */
  readonly round: number;
  readonly total: number;
}

export const DAILY_LEAVE_LABEL = "Leave daily challenge — your progress is saved";

/**
 * FocusBar for a daily stage: ✕ (App's leave handler already says the daily is saved) and
 * "Round N of 10" progress spanning the whole daily. Marks `root` as a focus screen.
 */
export function createDailyStageBar(root: HTMLElement, options: { readonly stage: string; readonly title?: string; readonly practice?: boolean; readonly progress?: DailyStageProgress; readonly onLeave: () => void }): FocusBarHandle {
  markShellScreen(root, "focus");
  const progress = options.progress;
  const count = el("span", { className: "gb-daily-count", text: progress ? `${options.practice ? "Review" : "Round"} ${progress.round} of ${progress.total}` : "Daily challenge" });
  const bar = createFocusBar({
    onClose: options.onLeave,
    closeLabel: options.practice ? "Back to daily result" : DAILY_LEAVE_LABEL,
    title: `${options.title ?? "Daily challenge"} · ${options.stage}`,
    progressLabel: "Daily challenge progress",
    trailing: count,
  });
  if (progress) bar.setProgress(Math.max(0, progress.round - 1) / Math.max(1, progress.total), count.textContent ?? "");
  else bar.setProgress(0);
  bar.element.classList.add("gb-daily-bar");
  return bar;
}

/** "You're 3 of 10 targets into this run…" while a run is part-way through, else null. */
export function runLeaveMessage(done: number, total: number, unit: string): string | null {
  if (done <= 0 || done >= total) return null;
  return `You're ${done} of ${total} ${unit} into this run. Leaving ends it and the score isn't kept.`;
}

/** Local (per-browser) best for a practice run's total. */
export function readLocalBest(storage: Storage | null | undefined, key: string): number {
  if (!storage) return 0;
  try {
    const value = Number.parseInt(storage.getItem(key) ?? "0", 10);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  } catch {
    return 0;
  }
}

export function recordLocalBest(storage: Storage | null | undefined, key: string, score: number): { readonly best: number; readonly previous: number; readonly isNew: boolean } {
  const previous = readLocalBest(storage, key);
  const best = Math.max(previous, Math.round(score));
  try {
    storage?.setItem(key, String(best));
  } catch {
    // Private mode / full storage: the best just isn't kept.
  }
  return { best, previous, isNew: score > previous };
}

export interface RunListRow {
  readonly label: string;
  readonly detail?: string;
  readonly value: string;
  /** Visual tone of the value: good / ok / miss. */
  readonly tone?: "good" | "ok" | "miss";
  readonly flagSrc?: string;
  /** Makes the row a button (e.g. open the country in the Atlas, or review a pin). */
  readonly onClick?: () => void;
  readonly ariaLabel?: string;
  readonly pressed?: boolean;
}

/** A compact numbered list of a run's rounds, placed inside the results card. */
export function createRunList(title: string, rows: readonly RunListRow[], className = ""): HTMLElement {
  const list = el("ol", {
    className: "gb-run-list-items",
    children: rows.map((row, index) => {
      const content = [
        el("span", { className: "gb-run-index", text: String(index + 1).padStart(2, "0") }),
        ...(row.flagSrc ? [el("img", { className: "gb-run-flag", attrs: { src: row.flagSrc, alt: "", width: "24", height: "16", loading: "lazy", decoding: "async" } })] : []),
        el("span", {
          className: "gb-run-copy",
          children: [el("strong", { text: row.label }), ...(row.detail ? [el("small", { text: row.detail })] : [])],
        }),
        el("span", { className: `gb-run-value${row.tone ? ` is-${row.tone}` : ""}`, text: row.value }),
      ];
      const item = row.onClick
        ? el("button", {
            className: "gb-run-row",
            attrs: { type: "button", ...(row.ariaLabel ? { "aria-label": row.ariaLabel } : {}), ...(row.pressed !== undefined ? { "aria-pressed": String(row.pressed) } : {}) },
            children: content,
            on: { click: row.onClick },
          })
        : el("div", { className: "gb-run-row", children: content });
      return el("li", { children: [item] });
    }),
  });
  return el("section", {
    className: `gb-run-list ${className}`.trim(),
    children: [el("h3", { className: "gb-run-list-title", text: title }), list],
  });
}

/** Put extra content (a run list) into a results card, above its actions. */
export function insertIntoResults(card: ResultsCardHandle, ...nodes: HTMLElement[]): void {
  const actions = card.element.querySelector(".shell-results-actions");
  for (const node of nodes) card.element.insertBefore(node, actions);
}

/** Five-level emoji row for share text. `fraction` is 0..1. */
export function shareSquare(fraction: number): string {
  return fraction >= 0.9 ? "🟩" : fraction >= 0.7 ? "🟨" : fraction >= 0.4 ? "🟧" : "⬜";
}

/**
 * A full-width stage that swaps in for the play layout at the end of a run. `show` mounts the
 * card, hides `playLayout`, and focuses the card heading; `hide` restores play.
 */
export function createResultsStage(playLayout: HTMLElement): { readonly element: HTMLElement; readonly show: (card: ResultsCardHandle) => void; readonly hide: () => void } {
  const element = el("section", { className: "gb-results-stage", attrs: { "aria-label": "Run results" } });
  element.hidden = true;
  return {
    element,
    show(card) {
      element.replaceChildren(card.element);
      element.hidden = false;
      playLayout.hidden = true;
      element.scrollTop = 0;
      // Phones scroll the page, not the stage: bring the card's top into view.
      const root = element.closest<HTMLElement>("#app");
      if (root) root.scrollTop = 0;
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try { window.scrollTo({ top: 0 }); } catch { /* non-browser environments */ }
      }
      card.focus();
    },
    hide() {
      element.hidden = true;
      element.replaceChildren();
      playLayout.hidden = false;
    },
  };
}
