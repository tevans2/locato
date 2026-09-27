import type { Country } from "../../core/countries";
import { gameModeCatalogueEntry, isLeaderboardMode, type TimerGameModeId } from "../../core/gameModes";
import { formatElapsedTime } from "../../core/timer/playTimer";
import { createResultsCard, type ResultsAction, type ResultsMissedCountry, type ResultsStat } from "../shell/ResultsCard";
import type { RunType, ShellContext } from "../shell/types";

/** Most countries a results card lists; the rest are summarised ("+N more"). */
export const RESULTS_MISSED_LIMIT = 24;

export interface TimedPostOutcome {
  readonly isNewLocalBest: boolean;
  /** null = not signed in (nothing posted); true = posted; false = kept locally (not faster than the posted best). */
  readonly serverAccepted: boolean | null;
}

export interface RunResultsInput {
  readonly mode: TimerGameModeId;
  readonly run: RunType;
  /** Leaderboard variant (flag set or puzzle continent); "" for none. */
  readonly variant: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly stats: readonly ResultsStat[];
  readonly missed?: readonly Country[];
  readonly missedTitle?: string;
  /** Play again (practice) / Run again (timed). */
  readonly onPlayAgain: () => void;
  readonly extraActions?: readonly ResultsAction[];
  readonly shareText: string;
  /** "neutral" for a given-up run. */
  readonly tone?: "celebrate" | "neutral";
  /** Timed runs: the leaderboard submission, resolved after the card is shown. */
  readonly posting?: Promise<TimedPostOutcome>;
}

export interface RunResultsHandle {
  readonly element: HTMLElement;
  readonly focus: () => void;
}

/** One line for the leaderboard submission of a finished timed run. */
export function timedPostingLine(outcome: TimedPostOutcome): string {
  const best = outcome.isNewLocalBest ? "New personal best. " : "";
  // TODO(compete-rank): once the Compete agent's rank helper lands in src/core/timer/leaderboardSync.ts,
  // show "Posted — you're #N on the board" here instead of the plain confirmation.
  if (outcome.serverAccepted === null) return `${best}Sign in to post your time to the leaderboard — your best is kept on this device.`;
  if (outcome.serverAccepted) return `${best}Posted to the leaderboard.`;
  return `${best}Saved on this device — your posted best is still faster.`;
}

function missedChips(countries: readonly Country[]): ResultsMissedCountry[] {
  return countries.slice(0, RESULTS_MISSED_LIMIT).map((country) => ({ code: country.code, name: country.name, flagSrc: country.flagSrc }));
}

/**
 * The end-of-run card for the prompt and world-map screens: practice runs cross-link to the
 * timed board in Compete, timed runs show the time, the submission result and "Practise this mode".
 */
export function createRunResults(shell: ShellContext, input: RunResultsInput): RunResultsHandle {
  const timed = input.run === "timed";
  const label = gameModeCatalogueEntry(input.mode).label;
  const leaderboard = isLeaderboardMode(input.mode);
  const missed = input.missed ?? [];
  const more = missed.length - RESULTS_MISSED_LIMIT;
  const secondary: ResultsAction[] = [];
  if (timed) secondary.push({ label: "View leaderboard", icon: "trophy", onClick: () => shell.openCompete(input.mode, input.variant || undefined) });
  secondary.push(...(input.extraActions ?? []));

  const card = createResultsCard(shell, {
    kicker: `${label} · ${timed ? "Timed run" : "Practice"}`,
    title: input.title,
    ...(input.subtitle || input.posting ? { subtitle: input.subtitle ?? (timed ? "Posting your time…" : "") } : {}),
    stats: input.stats,
    missed: missedChips(missed),
    ...(input.missedTitle || more > 0
      ? { missedTitle: `${input.missedTitle ?? "Worth another look"}${more > 0 ? ` (showing ${RESULTS_MISSED_LIMIT}, +${more} more)` : ""}` }
      : {}),
    primary: { label: timed ? "Run again" : "Play again", onClick: input.onPlayAgain, icon: "rotate-ccw" },
    secondary,
    share: { text: input.shareText, title: "Locato", ...(typeof window !== "undefined" ? { url: window.location.href } : {}) },
    ...(leaderboard
      ? {
          crossLink: timed
            ? { label: "Practise this mode", onClick: () => shell.openGame(input.mode, "practice") }
            : { label: "Try it timed →", onClick: () => shell.openCompete(input.mode, input.variant || undefined) },
        }
      : {}),
    tone: input.tone ?? "celebrate",
  });
  card.element.classList.add("game-run-results");
  card.element.dataset.run = input.run;

  if (input.posting) {
    const sub = card.element.querySelector<HTMLElement>(".shell-results-sub");
    void input.posting.then(
      (outcome) => {
        if (sub) sub.textContent = [input.subtitle, timedPostingLine(outcome)].filter(Boolean).join(" ");
        card.element.dataset.posted = outcome.serverAccepted === null ? "guest" : String(outcome.serverAccepted);
        if (outcome.serverAccepted === null && !card.element.querySelector(".game-results-signin")) {
          const signIn = document.createElement("button");
          signIn.type = "button";
          signIn.className = "shell-btn shell-btn-quiet game-results-signin";
          signIn.textContent = "Sign in to post";
          signIn.addEventListener("click", () => shell.openAccount());
          card.element.querySelector(".shell-results-secondary")?.prepend(signIn);
        }
      },
      () => {
        if (sub) sub.textContent = "Couldn't reach the leaderboard — your time is kept on this device.";
      },
    );
  }
  return card;
}

export function formatRunTime(ms: number): string {
  return formatElapsedTime(ms);
}

/** Practice "time spent", rounded to whole seconds (the tenths only matter against the clock). */
export function formatTimeSpent(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Show the card in place of the play surface (hideResultsIn puts the game back). */
export function showResultsIn(screen: HTMLElement, host: HTMLElement, card: RunResultsHandle): void {
  host.replaceChildren(card.element);
  host.hidden = false;
  screen.dataset.phase = "results";
  // Start at the top so the GameBar stays in view (the screen or, on phones, the app root scrolls).
  screen.scrollTop = 0;
  if (screen.parentElement) screen.parentElement.scrollTop = 0;
  card.focus();
}

export function hideResultsIn(screen: HTMLElement, host: HTMLElement): void {
  host.replaceChildren();
  host.hidden = true;
  delete screen.dataset.phase;
}
