import { gameModeCatalogueEntry, type GameModeId } from "../../core/gameModes";
import { isSingleRunMode, leaderboardConfig } from "../../core/leaderboards";
import { postRankedAttempt } from "../../core/timer/leaderboardSync";
import { createGameBar, type GameBarHandle, type GameBarMenuItem } from "../shell/GameBar";
import { createResultsCard, type ResultsAction, type ResultsCardHandle, type ResultsCardOptions, type ResultsStat } from "../shell/ResultsCard";
import { markShellScreen, type ShellContext } from "../shell/types";
import { attachPostingOutcome, type TimedPostOutcome } from "./gameResults";
import { formatNumber, readLocalBest, recordLocalBest } from "./practiceRun";

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
  return { label: "Play a ranked attempt →", onClick: () => shell.openLeaderboards(mode) };
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
    // A cold ranked link backs out to its own board rather than the first board.
    onBack: () => shell.goBack(() => shell.openLeaderboards(options.gameMode)),
    backLabel: "Back to leaderboards",
    leaveGuard: () => (options.inProgress() ? RANKED_LEAVE_MESSAGE : null),
    ...(options.onHowToPlay ? { onHowToPlay: options.onHowToPlay } : {}),
    ...(options.extraMenuItems ? { extraMenuItems: options.extraMenuItems } : {}),
  });
}

export function rankedBestKey(mode: GameModeId): string {
  return `locato:ranked-best:${mode}:v1`;
}

/** Practice bests kept before these modes became single-run; they still count towards your best. */
const LEGACY_PRACTICE_BEST_KEYS: Partial<Record<GameModeId, string>> = {
  worldsplit: "locato:worldsplit:best-score:v1",
  flyover: "locato:flyover:best-score:v1",
  geoguessr: "locato:geoguessr:best-run:v1",
};

/** A single-run mode's best score on this device (0 when there is none). */
export function readSingleBest(storage: Storage | null | undefined, mode: GameModeId): number {
  const legacy = LEGACY_PRACTICE_BEST_KEYS[mode];
  return Math.max(readLocalBest(storage, rankedBestKey(mode)), legacy ? readLocalBest(storage, legacy) : 0);
}

export interface BestBarOptions {
  readonly gameMode: GameModeId;
  readonly storage?: Storage | null;
  readonly extraMenuItems?: readonly GameBarMenuItem[];
  readonly onHowToPlay?: () => void;
}

/**
 * GameBar for a single-run mode (Worldsplit, Flyover, GeoGuessr, Street View country): no
 * Practice / Ranked choice, a "Best" badge instead, and leaving never asks — an unfinished run
 * just isn't counted. Call `refreshBest` after a run is submitted.
 */
export function createBestBar(root: HTMLElement, shell: ShellContext, options: BestBarOptions): GameBarHandle & { readonly refreshBest: () => void } {
  markShellScreen(root, "game");
  const best = () => {
    const value = readSingleBest(options.storage ?? shell.storage, options.gameMode);
    return value > 0 ? formatNumber(value) : null;
  };
  const bar = createGameBar(shell, {
    gameMode: options.gameMode,
    run: "practice",
    onBack: () => shell.goBack("play"),
    backLabel: "Back",
    best: best(),
    ...(options.onHowToPlay ? { onHowToPlay: options.onHowToPlay } : {}),
    ...(options.extraMenuItems ? { extraMenuItems: options.extraMenuItems } : {}),
  });
  return { ...bar, refreshBest: () => bar.setBest(best()) };
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
  const storage = input.storage ?? null;
  // A single-run mode's old practice best counts too, so "New personal best" means beating it.
  const previousBest = isSingleRunMode(input.mode) ? readSingleBest(storage, input.mode) : readLocalBest(storage, rankedBestKey(input.mode));
  const recorded = recordLocalBest(storage, rankedBestKey(input.mode), Math.max(previousBest, input.total));
  const local = { previous: previousBest, isNew: input.total > previousBest, best: recorded.best };
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
 * "Practise this mode". A single-run mode's card is the same without the ranked framing: "Play
 * again", and no practice cross-link (there is only one way to play).
 */
export function createRankedResults(shell: ShellContext, input: RankedResultsInput): ResultsCardHandle {
  const label = gameModeCatalogueEntry(input.mode).label;
  const maxScore = leaderboardConfig(input.mode)?.maxScore;
  const single = isSingleRunMode(input.mode);
  const card = createResultsCard(shell, {
    kicker: single ? label : `${label} · Ranked attempt`,
    title: input.title,
    subtitle: "Posting your score…",
    stats: input.stats,
    ...(input.missed ? { missed: input.missed } : {}),
    ...(input.missedTitle ? { missedTitle: input.missedTitle } : {}),
    primary: { label: single ? "Play again" : "Try again", icon: "rotate-ccw", onClick: input.onTryAgain },
    secondary: [{ label: "View leaderboard", icon: "trophy", onClick: () => shell.openLeaderboards(input.mode) }],
    share: {
      title: input.shareTitle,
      text: input.shareText,
      ...(typeof window !== "undefined" ? { url: window.location.href } : {}),
    },
    ...(single ? {} : { crossLink: { label: "Practise this mode", onClick: () => shell.openGame(input.mode, "practice") } }),
    tone: input.tone ?? "celebrate",
  });
  card.element.classList.add("game-run-results", "is-ranked");
  card.element.dataset.run = single ? "single" : "timed";
  if (maxScore !== undefined) card.element.dataset.maxScore = String(maxScore);
  attachPostingOutcome(shell, card, input.posting, { metric: "score" });
  return card;
}
