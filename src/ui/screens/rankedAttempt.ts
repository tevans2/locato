import { gameModeCatalogueEntry, type GameModeId } from "../../core/gameModes";
import { leaderboardConfig } from "../../core/leaderboards";
import { postRankedAttempt } from "../../core/timer/leaderboardSync";
import { createGameBar, type GameBarHandle, type GameBarMenuItem } from "../shell/GameBar";
import { createResultsCard, type ResultsAction, type ResultsCardHandle, type ResultsCardOptions, type ResultsStat } from "../shell/ResultsCard";
import { markShellScreen, type ShellContext } from "../shell/types";
import { attachPostingOutcome, type TimedPostOutcome } from "./gameResults";
import { recordLocalBest } from "./practiceRun";

/**
 * Ranked attempts for the score modes (MapTap, Worldsplit, GeoGuessr, Street View country): one
 * fixed-length attempt with fixed, fair settings whose total posts to the mode's score board
 * (src/core/leaderboards.ts). The route is the same `&run=timed` as a timed run; players see
 * "Ranked" instead of a clock. An attempt can't be restarted part-way for a better score.
 */

export type PostRankedAttempt = typeof postRankedAttempt;

/** What leaving (Back, switching game, a section link) asks while a ranked attempt is under way. */
export const RANKED_LEAVE_MESSAGE = "Leave this ranked attempt? It won't be posted.";

/** "Practice results → play for keeps": the cross-link on a score mode's practice results card. */
export function rankedCrossLink(shell: ShellContext, mode: GameModeId): ResultsAction {
  return { label: "Play a ranked attempt →", onClick: () => shell.openCompete(mode) };
}

export interface RankedBarOptions {
  readonly gameMode: GameModeId;
  /** True while the attempt is under way (leaving then asks first). */
  readonly inProgress: () => boolean;
  readonly extraMenuItems?: readonly GameBarMenuItem[];
  readonly onHowToPlay?: () => void;
}

/** GameBar for a ranked attempt: the "Ranked" pill, and ← goes back to the mode's board. */
export function createRankedBar(root: HTMLElement, shell: ShellContext, options: RankedBarOptions): GameBarHandle {
  markShellScreen(root, "game");
  return createGameBar(shell, {
    gameMode: options.gameMode,
    run: "timed",
    // A cold ranked link backs out to its own board rather than the Compete landing tab.
    onBack: () => shell.goBack(() => shell.openCompete(options.gameMode)),
    backLabel: "Back to Compete",
    leaveGuard: () => (options.inProgress() ? RANKED_LEAVE_MESSAGE : null),
    ...(options.onHowToPlay ? { onHowToPlay: options.onHowToPlay } : {}),
    ...(options.extraMenuItems ? { extraMenuItems: options.extraMenuItems } : {}),
  });
}

export function rankedBestKey(mode: GameModeId): string {
  return `locato:ranked-best:${mode}:v1`;
}

/**
 * Submit a finished attempt's total (signed in) or look up where it would place (guest). Keeps a
 * per-device best so the card can say "New personal best". Never rejects.
 */
export async function submitRankedAttempt(input: {
  readonly shell: ShellContext;
  readonly mode: GameModeId;
  readonly total: number;
  readonly storage?: Storage | null;
  readonly post?: PostRankedAttempt;
}): Promise<TimedPostOutcome> {
  const local = recordLocalBest(input.storage ?? null, rankedBestKey(input.mode), input.total);
  const post = input.post ?? postRankedAttempt;
  try {
    const posting = await post({ gameMode: input.mode, variant: "", value: Math.round(input.total), isLoggedIn: input.shell.signedIn() });
    return { isNewLocalBest: local.isNew && local.previous > 0, ...posting };
  } catch {
    return { isNewLocalBest: local.isNew && local.previous > 0, serverAccepted: input.shell.signedIn() ? false : null, rank: null, failed: true };
  }
}

export interface RankedResultsInput {
  readonly mode: GameModeId;
  readonly title: string;
  /** Hero stat first ("Total score"). */
  readonly stats: readonly ResultsStat[];
  readonly total: number;
  readonly shareTitle: string;
  readonly shareText: string;
  /** Starts a fresh ranked attempt. */
  readonly onTryAgain: () => void;
  readonly posting: Promise<TimedPostOutcome>;
  readonly missed?: ResultsCardOptions["missed"];
  readonly missedTitle?: string;
  readonly tone?: "celebrate" | "neutral";
}

/**
 * The end of a ranked attempt: the total, the post outcome and rank ("Posted to the leaderboard —
 * you're #N" / "That would place #N… Sign in to post"), Try again · View leaderboard · Share, and
 * "Practise this mode".
 */
export function createRankedResults(shell: ShellContext, input: RankedResultsInput): ResultsCardHandle {
  const label = gameModeCatalogueEntry(input.mode).label;
  const maxScore = leaderboardConfig(input.mode)?.maxScore;
  const card = createResultsCard(shell, {
    kicker: `${label} · Ranked attempt`,
    title: input.title,
    subtitle: "Posting your score…",
    stats: input.stats,
    ...(input.missed ? { missed: input.missed } : {}),
    ...(input.missedTitle ? { missedTitle: input.missedTitle } : {}),
    primary: { label: "Try again", icon: "rotate-ccw", onClick: input.onTryAgain },
    secondary: [{ label: "View leaderboard", icon: "trophy", onClick: () => shell.openCompete(input.mode) }],
    share: {
      title: input.shareTitle,
      text: input.shareText,
      ...(typeof window !== "undefined" ? { url: window.location.href } : {}),
    },
    crossLink: { label: "Practise this mode", onClick: () => shell.openGame(input.mode, "practice") },
    tone: input.tone ?? "celebrate",
  });
  card.element.classList.add("game-run-results", "is-ranked");
  card.element.dataset.run = "timed";
  if (maxScore !== undefined) card.element.dataset.maxScore = String(maxScore);
  attachPostingOutcome(shell, card, input.posting, { metric: "score" });
  return card;
}
