/**
 * Run audit: a record of how a run was played, so the server (and an admin) can tell an honest
 * run from a forged or scripted one. Shared by the browser (which records it), the server (which
 * checks it when a run ends) and the admin console (which shows it).
 *
 * A run's timeline holds one entry per country found: its code, when it was found (ms into the
 * run) and how it was typed (input events since the previous country, split into real ones the
 * browser marks trusted and synthetic ones a script created). Signals cover the whole run.
 *
 * Name all countries is the first mode audited; the checks are written so other timed modes can
 * reuse them with their own timelines.
 */

export const AUDITED_MODES = ["name-all"] as const;
export type AuditedMode = (typeof AUDITED_MODES)[number];

export function isAuditedMode(mode: string): mode is AuditedMode {
  return (AUDITED_MODES as readonly string[]).includes(mode);
}

/** One country found: [country code, ms into the run, trusted input events, synthetic input events]. */
export type RunEntry = readonly [code: string, t: number, keys: number, synthetic: number];

export interface RunSignals {
  /** Paste events in the answer box. */
  readonly pastes: number;
  /** Total time the tab was hidden while the run was going. */
  readonly hiddenMs: number;
}

export interface RunTimeline {
  readonly entries: readonly RunEntry[];
  readonly signals: RunSignals;
}

export type RunOutcome = "complete" | "given-up" | "abandoned";

export type RunFlagCode =
  | "no-ticket"
  | "server-time-short"
  | "clock-slow"
  | "time-mismatch"
  | "bad-countries"
  | "no-typing"
  | "below-floor"
  | "synthetic-input"
  | "fast-burst"
  | "even-pace"
  | "list-order"
  | "tab-hidden"
  | "paste"
  | "big-improvement"
  | "overlapping-run";

/** "reject": never honest, refused when enforcing. "review": a sign worth a look, never refused. */
export type RunFlagSeverity = "reject" | "review";

export interface RunFlag {
  readonly code: RunFlagCode;
  readonly severity: RunFlagSeverity;
  readonly detail: string;
}

export type RunVerdict = "ok" | "review" | "reject";

// --- Thresholds --------------------------------------------------------------------------------
// Set against real runs: the fastest honest Name all countries run so far is 3:47 (0.86
// countries/s on average), and honest players' fastest stretches stay under 1 country a second.

/** No honest Name all countries run is faster than this. */
export const NAME_ALL_FLOOR_MS = 120_000;
/** Countries in any 60 seconds above this rate (1.2/s) is faster than anyone has typed. */
export const FAST_BURST_PER_MINUTE = 72;
/** People go in bursts and stall on hard ones; a gap spread this even is a script's fixed delay. */
export const EVEN_PACE_MAX_VARIATION = 0.35;
/** Order this close to a list (A–Z, or the game's own country order) is a script working through it. */
export const LIST_ORDER_MIN_CORRELATION = 0.9;
export const TAB_HIDDEN_REVIEW_MS = 10_000;
/** A new best this much faster than the previous one (25%) is a jump worth checking. */
export const BIG_IMPROVEMENT_RATIO = 0.75;
/** Slack between the claimed time and what the server measured: network, a slow first request. */
export const SERVER_TIME_SLACK_MS = 3_000;
/** The timeline's last country and the claimed time should agree to within this. */
export const TIMELINE_TIME_SLACK_MS = 1_500;
/** Pattern checks need enough countries to mean anything. */
const MIN_ENTRIES_FOR_PATTERNS = 30;

export const MAX_TIMELINE_ENTRIES = 400;
const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENT_COUNT = 10_000;

// --- Parsing -----------------------------------------------------------------------------------

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_EVENT_COUNT;
}

/** A timeline from untrusted JSON, or null if it isn't one. Never trusts the shape. */
export function parseRunTimeline(value: unknown): RunTimeline | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { entries, signals } = record;
  if (!Array.isArray(entries) || entries.length > MAX_TIMELINE_ENTRIES) return null;
  const parsed: RunEntry[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 4) return null;
    const [code, t, keys, synthetic] = entry as unknown[];
    if (typeof code !== "string" || code.length === 0 || code.length > 8) return null;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > MAX_ENTRY_MS) return null;
    if (!isCount(keys) || !isCount(synthetic)) return null;
    parsed.push([code, Math.round(t), keys, synthetic]);
  }
  if (typeof signals !== "object" || signals === null) return null;
  const { pastes, hiddenMs } = signals as Record<string, unknown>;
  if (!isCount(pastes) || typeof hiddenMs !== "number" || !Number.isFinite(hiddenMs) || hiddenMs < 0 || hiddenMs > MAX_ENTRY_MS) return null;
  return { entries: parsed, signals: { pastes, hiddenMs: Math.round(hiddenMs) } };
}

// --- Statistics --------------------------------------------------------------------------------

/** The most countries found in any window of `windowMs`. */
export function maxInWindow(times: readonly number[], windowMs: number): number {
  let best = 0;
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end]! - times[start]! > windowMs) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/** Coefficient of variation (spread ÷ mean) of the gaps between consecutive finds. */
export function gapVariation(times: readonly number[]): number | null {
  if (times.length < 3) return null;
  const gaps = times.slice(1).map((t, index) => t - times[index]!);
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (mean <= 0) return 0;
  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean;
}

/** Spearman rank correlation between the order things were found and their order in `reference`. */
export function orderCorrelation(found: readonly string[], reference: readonly string[]): number | null {
  const position = new Map(reference.map((item, index) => [item, index]));
  const ranks = found.map((item) => position.get(item)).filter((rank): rank is number => rank !== undefined);
  const n = ranks.length;
  if (n < 3) return null;
  // Re-rank the reference positions 0..n-1, then compare with the find order 0..n-1.
  const sorted = ranks.map((rank, index) => ({ rank, index })).sort((a, b) => a.rank - b.rank);
  const referenceRank = new Array<number>(n);
  sorted.forEach((item, order) => { referenceRank[item.index] = order; });
  let sumSquares = 0;
  for (let index = 0; index < n; index += 1) sumSquares += (index - referenceRank[index]!) ** 2;
  return 1 - (6 * sumSquares) / (n * (n * n - 1));
}

// --- The checks --------------------------------------------------------------------------------

export interface RunAuditInput {
  readonly mode: AuditedMode;
  readonly timed: boolean;
  readonly outcome: RunOutcome;
  readonly timeline: RunTimeline | null;
  /** The time the player's run claims (timed, finished runs posted to the board). */
  readonly claimedMs: number | null;
  /** How long the run lasted by the server's clock: ticket issued → run ended. Null without a ticket. */
  readonly serverElapsedMs: number | null;
  /** Every country code the mode expects, in the game's own order. */
  readonly countryCodes: readonly string[];
  /** Every country's name by code, for the A–Z check. */
  readonly countryNames: ReadonlyMap<string, string>;
  /** The player's best on this board before this run. */
  readonly previousBestMs: number | null;
  /** The player's previous run ended after this one started (two runs at once). */
  readonly overlapsPreviousRun: boolean;
}

function flag(code: RunFlagCode, severity: RunFlagSeverity, detail: string): RunFlag {
  return { code, severity, detail };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Everything wrong with a run. Hard checks ("reject") only apply to a timed run posted to the
 * board, where a forged time would land; pattern checks ("review") apply to every run, practice
 * included, since a script tried out in practice is the tell.
 */
export function auditRun(input: RunAuditInput): readonly RunFlag[] {
  const flags: RunFlag[] = [];
  const posted = input.timed && input.outcome === "complete" && input.claimedMs !== null;
  const timeline = input.timeline;

  if (posted) {
    const claimed = input.claimedMs!;
    if (input.serverElapsedMs === null) {
      flags.push(flag("no-ticket", "reject", "Posted without a run the server saw start."));
    } else if (claimed > input.serverElapsedMs + SERVER_TIME_SLACK_MS) {
      flags.push(flag("server-time-short", "reject", `Claimed ${seconds(claimed)} but the server only saw the run last ${seconds(input.serverElapsedMs)}.`));
    } else if (input.serverElapsedMs - claimed > Math.max(10_000, claimed * 0.1)) {
      // The game clock ran slow against the server's: paused, or tampered with.
      flags.push(flag("clock-slow", "review", `Claimed ${seconds(claimed)} but the run lasted ${seconds(input.serverElapsedMs)} by the server's clock.`));
    }
    if (claimed < NAME_ALL_FLOOR_MS) flags.push(flag("below-floor", "reject", `${seconds(claimed)} is faster than any honest run (floor ${seconds(NAME_ALL_FLOOR_MS)}).`));
    if (!timeline) {
      flags.push(flag("bad-countries", "reject", "Posted without a timeline of the countries found."));
    } else {
      const last = timeline.entries.at(-1)?.[1] ?? 0;
      if (Math.abs(last - claimed) > TIMELINE_TIME_SLACK_MS) flags.push(flag("time-mismatch", "reject", `The last country was found at ${seconds(last)}, not ${seconds(claimed)}.`));
      const codes = timeline.entries.map((entry) => entry[0]);
      const unique = new Set(codes);
      const expected = new Set(input.countryCodes);
      const unknown = codes.filter((code) => !expected.has(code)).length;
      const missing = input.countryCodes.filter((code) => !unique.has(code)).length;
      if (unique.size !== codes.length || unknown > 0 || missing > 0) {
        flags.push(flag("bad-countries", "reject", `${codes.length} entries: ${codes.length - unique.size} repeated, ${unknown} unknown, ${missing} missing.`));
      }
    }
  }

  if (posted && input.previousBestMs !== null && input.claimedMs! < input.previousBestMs * BIG_IMPROVEMENT_RATIO) {
    flags.push(flag("big-improvement", "review", `${seconds(input.claimedMs!)} after a previous best of ${seconds(input.previousBestMs)}.`));
  }
  if (input.overlapsPreviousRun) flags.push(flag("overlapping-run", "review", "Started before the player's previous run ended (two at once)."));

  if (!timeline || timeline.entries.length === 0) return flags;
  const entries = timeline.entries;
  const times = entries.map((entry) => entry[1]);

  // Every country is typed: the box needs letters before it can match one. A script that sets the
  // box's value from the page makes synthetic events, or none at all.
  const untyped = entries.filter((entry) => entry[2] === 0).length;
  if (untyped > 0) {
    const share = untyped / entries.length;
    flags.push(flag("no-typing", posted && share > 0.1 ? "reject" : "review", `${untyped} of ${entries.length} countries found with no real typing.`));
  }
  const synthetic = entries.reduce((sum, entry) => sum + entry[3], 0);
  if (synthetic > 0) flags.push(flag("synthetic-input", "review", `${synthetic} input events came from page script, not the keyboard.`));

  const burst = maxInWindow(times, 60_000);
  const span = times.at(-1)! - times[0]!;
  if (burst > FAST_BURST_PER_MINUTE) {
    flags.push(flag("fast-burst", "review", `${burst} countries in 60 seconds (more than ${FAST_BURST_PER_MINUTE}).`));
  } else if (entries.length >= 20 && span < 60_000 && span > 0 && (entries.length - 1) / (span / 60_000) > FAST_BURST_PER_MINUTE) {
    flags.push(flag("fast-burst", "review", `${entries.length} countries in ${seconds(span)}.`));
  }

  if (entries.length >= MIN_ENTRIES_FOR_PATTERNS) {
    const variation = gapVariation(times);
    if (variation !== null && variation < EVEN_PACE_MAX_VARIATION) {
      flags.push(flag("even-pace", "review", `Gaps between countries vary by only ${Math.round(variation * 100)}% (people vary far more).`));
    }
    const found = entries.map((entry) => entry[0]);
    const alphabetical = [...input.countryCodes].sort((a, b) => (input.countryNames.get(a) ?? a).localeCompare(input.countryNames.get(b) ?? b));
    const listOrder = Math.max(orderCorrelation(found, input.countryCodes) ?? 0, orderCorrelation(found, alphabetical) ?? 0);
    if (listOrder >= LIST_ORDER_MIN_CORRELATION) {
      flags.push(flag("list-order", "review", `Found in list order (correlation ${listOrder.toFixed(2)}); people go region by region.`));
    }
  }

  if (timeline.signals.hiddenMs > TAB_HIDDEN_REVIEW_MS) flags.push(flag("tab-hidden", "review", `Tab hidden for ${seconds(timeline.signals.hiddenMs)} during the run.`));
  if (timeline.signals.pastes > 0) flags.push(flag("paste", "review", `${timeline.signals.pastes} paste${timeline.signals.pastes === 1 ? "" : "s"} into the answer box.`));

  return flags;
}

export function runVerdict(flags: readonly RunFlag[]): RunVerdict {
  if (flags.some((item) => item.severity === "reject")) return "reject";
  return flags.length > 0 ? "review" : "ok";
}

export const RUN_FLAG_LABELS: Record<RunFlagCode, string> = {
  "no-ticket": "no ticket",
  "server-time-short": "longer than the run",
  "clock-slow": "clock slow",
  "time-mismatch": "time mismatch",
  "bad-countries": "bad countries",
  "no-typing": "no typing",
  "below-floor": "below floor",
  "synthetic-input": "scripted input",
  "fast-burst": "too fast",
  "even-pace": "even pace",
  "list-order": "list order",
  "tab-hidden": "tab hidden",
  paste: "pasted",
  "big-improvement": "big jump",
  "overlapping-run": "overlapping",
};
