import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The daily is played and scored in the browser, so the server can't prove a result. What it can
// do is note when a player pressed Start: the client fetches a signed start ticket and sends it
// back with its result. A result that claims more play than has passed since its ticket, beats a
// human floor, or comes without a ticket is still saved (and shown to its player) but kept off
// everyone else's boards until an admin approves it.

const VERSION = "d1";
const DAY_MS = 86_400_000;
/** Ten rounds faster than this isn't humanly plausible, even knowing every answer. */
export const DAILY_MIN_PLAY_MS = 30_000;
// Client and server clocks, and the gap between Start and the first round, both drift a little.
const CLAIM_SLACK_MS = 15_000;

export type DailyHiddenReason = "no-start" | "too-fast" | "time-mismatch" | "start-reused" | "admin";

export interface DailyStartTicket {
  readonly date: string;
  readonly startedAt: number;
  readonly nonce: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
}

/** Today's dates somewhere on Earth: the daily follows the player's local calendar. */
export function isCurrentDailyDate(date: string, now: number): boolean {
  const at = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(at) && Math.abs(at - now) <= 1.5 * DAY_MS;
}

export function createStartTicket(secret: string, date: string, now: number): string {
  const payload = `${VERSION}.${date}.${now}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function readStartTicket(secret: string, ticket: unknown): DailyStartTicket | null {
  if (typeof ticket !== "string" || ticket.length > 120) return null;
  const parts = ticket.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, date, startedAt, nonce, signature] = parts as [string, string, string, string, string];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{13}$/.test(startedAt) || !/^[A-Za-z0-9_-]{12}$/.test(nonce)) return null;
  const expected = Buffer.from(sign(secret, parts.slice(0, 4).join(".")));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { date, startedAt: Number(startedAt), nonce };
}

/** Why a daily result should be kept off other players' boards, or null to show it. */
export function assessDailyResult(
  result: { readonly date: string; readonly timeMs: number },
  ticket: DailyStartTicket | null,
  now: number,
  startUsedByAnother: boolean,
): DailyHiddenReason | null {
  if (result.timeMs < DAILY_MIN_PLAY_MS) return "too-fast";
  if (!ticket || ticket.date !== result.date) return "no-start";
  if (startUsedByAnother) return "start-reused";
  const sinceStart = now - ticket.startedAt;
  if (sinceStart < DAILY_MIN_PLAY_MS) return "too-fast";
  // The client counts active play only, so it can never honestly exceed the time since Start.
  if (result.timeMs > sinceStart + CLAIM_SLACK_MS) return "time-mismatch";
  return null;
}
