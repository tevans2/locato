import { fameTier } from "../countries/fame";
import type { BorderGraph } from "./graph";
import type { OverlandRoute } from "./routes";

/**
 * How close a guessed country is to a shortest route, by how much longer the best route through
 * it is: on a shortest route, one crossing longer, two longer, or further / not reachable by land.
 */
export type OverlandVerdict = "route" | "close" | "detour" | "off";

export const OVERLAND_VERDICTS: Readonly<Record<OverlandVerdict, { readonly label: string; readonly emoji: string; readonly description: string }>> = {
  route: { label: "On route", emoji: "🟩", description: "It's on a shortest route." },
  close: { label: "Close", emoji: "🟨", description: "A route through it is one country longer." },
  detour: { label: "Detour", emoji: "🟧", description: "A route through it is two countries longer." },
  off: { label: "Off course", emoji: "🟥", description: "Further away, or not reachable by land." },
};

/** Points for a route found in the fewest guesses with no hints. */
export const OVERLAND_ROUTE_MAX_POINTS = 100;
/** Lost for every guess beyond the shortest route's length. */
export const OVERLAND_EXTRA_GUESS_PENALTY = 10;
/** Lost for every hint. */
export const OVERLAND_HINT_PENALTY = 15;
/** A found route is always worth at least this much; a missed one scores nothing. */
export const OVERLAND_MIN_SOLVED_POINTS = 10;
export const OVERLAND_MAX_HINTS = 3;

export function overlandVerdict(graph: BorderGraph, route: Pick<OverlandRoute, "start" | "end">, code: string): OverlandVerdict {
  const excess = graph.excess(route.start, route.end, code);
  if (excess === null || excess >= 3) return "off";
  return excess === 0 ? "route" : excess === 1 ? "close" : "detour";
}

export interface OverlandGuess {
  readonly code: string;
  readonly verdict: OverlandVerdict;
}

/** solved: the guesses join start to end · failed: out of guesses · revealed: given up. */
export type OverlandRoundStatus = "playing" | "solved" | "failed" | "revealed";

export interface OverlandRound {
  readonly route: OverlandRoute;
  readonly guesses: readonly OverlandGuess[];
  readonly hintsUsed: number;
  /** Countries whose outline a hint has drawn on the map (their initials too, after the third hint). */
  readonly outlined: readonly string[];
  readonly status: OverlandRoundStatus;
}

export function createOverlandRound(route: OverlandRoute): OverlandRound {
  return { route, guesses: [], hintsUsed: 0, outlined: [], status: "playing" };
}

export type OverlandGuessError = "finished" | "unknown" | "endpoint" | "repeat";

/**
 * Add a guessed country. The round is solved as soon as the guesses join start to end by land —
 * through any route, not only a shortest one — and failed when the last allowed guess doesn't.
 */
export function guessOverland(graph: BorderGraph, round: OverlandRound, code: string): { readonly round: OverlandRound; readonly guess: OverlandGuess } | { readonly error: OverlandGuessError } {
  if (round.status !== "playing") return { error: "finished" };
  if (!graph.has(code)) return { error: "unknown" };
  if (code === round.route.start || code === round.route.end) return { error: "endpoint" };
  if (round.guesses.some((guess) => guess.code === code)) return { error: "repeat" };
  const guess: OverlandGuess = { code, verdict: overlandVerdict(graph, round.route, code) };
  const guesses = [...round.guesses, guess];
  const joined = graph.connects(round.route.start, round.route.end, guesses.map((item) => item.code));
  const status: OverlandRoundStatus = joined ? "solved" : guesses.length >= round.route.guessesAllowed ? "failed" : "playing";
  return { round: { ...round, guesses, status }, guess };
}

export interface OverlandHint {
  /** 1: the next country's outline · 2: every missing country's outline · 3: their initials. */
  readonly level: number;
  readonly outlined: readonly string[];
}

/** Hints come in order, each stronger than the last. */
export const OVERLAND_HINT_LABELS: readonly string[] = ["Outline the next country", "Outline every missing country", "Show their initials"];

/**
 * The shortest route that keeps the most of the player's guesses (better-known countries break
 * ties), endpoints included. Hints point along it and a missed route is revealed with it.
 */
export function overlandBestRoute(graph: BorderGraph, round: OverlandRound): readonly string[] {
  const guessed = new Set(round.guesses.map((guess) => guess.code));
  return graph.shortestRoute(round.route.start, round.route.end, guessed, fameTier) ?? [round.route.start, round.route.end];
}

/** Countries on `overlandBestRoute` the player hasn't named yet, in route order. */
export function overlandMissingCountries(graph: BorderGraph, round: OverlandRound): readonly string[] {
  const guessed = new Set(round.guesses.map((guess) => guess.code));
  return overlandBestRoute(graph, round).slice(1, -1).filter((code) => !guessed.has(code));
}

export function hintOverland(graph: BorderGraph, round: OverlandRound): { readonly round: OverlandRound; readonly hint: OverlandHint } | { readonly error: "finished" | "no-hints" } {
  if (round.status !== "playing") return { error: "finished" };
  if (round.hintsUsed >= OVERLAND_MAX_HINTS) return { error: "no-hints" };
  const level = round.hintsUsed + 1;
  const missing = overlandMissingCountries(graph, round);
  const added = level === 1 ? missing.slice(0, 1) : missing;
  const outlined = [...round.outlined, ...added.filter((code) => !round.outlined.includes(code))];
  return { round: { ...round, hintsUsed: level, outlined }, hint: { level, outlined } };
}

/** Give up on the route: it scores nothing and the shortest route is shown. */
export function revealOverland(round: OverlandRound): OverlandRound {
  return round.status === "playing" ? { ...round, status: "revealed" } : round;
}

export function overlandRoundPoints(round: OverlandRound): number {
  if (round.status !== "solved") return 0;
  const extraGuesses = Math.max(0, round.guesses.length - round.route.minimum);
  return Math.max(OVERLAND_MIN_SOLVED_POINTS, OVERLAND_ROUTE_MAX_POINTS - OVERLAND_EXTRA_GUESS_PENALTY * extraGuesses - OVERLAND_HINT_PENALTY * round.hintsUsed);
}

/** A perfect route: found in the fewest possible guesses, without a hint. */
export function isPerfectOverlandRound(round: OverlandRound): boolean {
  return overlandRoundPoints(round) === OVERLAND_ROUTE_MAX_POINTS;
}

/** The route the player's own guesses make (endpoints included), once solved. */
export function overlandPlayerRoute(graph: BorderGraph, round: OverlandRound): readonly string[] | null {
  return round.status === "solved" ? graph.routeWithin(round.route.start, round.route.end, round.guesses.map((guess) => guess.code)) : null;
}

/** One line of share text: a square per guess, a bulb per hint, then the points ("—" if missed). */
export function overlandShareLine(round: OverlandRound): string {
  const squares = round.guesses.map((guess) => OVERLAND_VERDICTS[guess.verdict].emoji).join("") || "·";
  const hints = round.hintsUsed > 0 ? ` ${"💡".repeat(round.hintsUsed)}` : "";
  const points = overlandRoundPoints(round);
  return `${squares}${hints} ${points > 0 ? `+${points}` : "—"}`;
}

/**
 * Today's route as share text: the day's number with how it went, the two ends, a square per
 * guess (and a bulb per hint), then the link. It shows how you did, never which countries.
 *
 *   #locato Overland #12 (+1)
 *   Greece → Sudan
 *   🟥🟩🟩🟩🟩
 *   https://locato.quest/?game=overland&daily=1
 */
export function overlandDailyShareText(round: OverlandRound, details: { readonly number: number; readonly startName: string; readonly endName: string; readonly url: string; readonly away: number }): string {
  const extra = Math.max(0, round.guesses.length - round.route.minimum);
  const tally = round.status === "solved" ? (extra === 0 ? "(perfect)" : `(+${extra})`) : round.status === "failed" ? `(${details.away} away)` : "(gave up)";
  const squares = round.guesses.map((guess) => OVERLAND_VERDICTS[guess.verdict].emoji).join("") || "·";
  const hints = round.hintsUsed > 0 ? ` ${"💡".repeat(round.hintsUsed)}` : "";
  return `#locato Overland #${details.number} ${tally}\n${details.startName} → ${details.endName}\n${squares}${hints}\n${details.url}`;
}
