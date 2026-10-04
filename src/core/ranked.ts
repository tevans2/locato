import type { GameModeId } from "./gameModes";
import type { PlaneInput, PlaneState } from "./flyover";
import type { ProjectedPoint } from "./map";
import type { Hint } from "./game";
import type { MapTapGuessResult, MapTapRoundTarget } from "./maptap/types";
import type { GeoGuessrGuessResult } from "./geoguessr";
import type { WorldSplitResult } from "./worldsplit";

/** Only the current challenge crosses the wire. Future queues stay on the server. */
export interface RankedQuestion {
  readonly id: string;
  readonly kind: "text" | "image" | "flag-colors" | "name-all" | "click" | "spot" | "puzzle" | "pin" | "street" | "split" | "flight";
  readonly text: string;
  readonly asset?: string;
  /** "shape": `asset` is a white country outline, drawn with the outline styling. */
  readonly presentation?: "shape";
  readonly paths?: readonly (readonly ProjectedPoint[])[];
  readonly frames?: readonly { readonly asset: string }[];
  readonly mapTap?: MapTapRoundTarget;
  /** Current-clue presentation only. Never authorizes an answer or exposes future questions. */
  readonly answerToken?: string;
}

/** Answer details are revealed only after the corresponding move has been checked. */
export interface RankedMoveResult {
  readonly questionId: string;
  readonly kind: "correct" | "wrong" | "hint" | "skipped" | "revealed" | "pin" | "line" | "placement";
  readonly countryCode?: string;
  readonly hint?: Hint;
  readonly mapTap?: MapTapGuessResult;
  readonly geo?: GeoGuessrGuessResult;
  readonly split?: WorldSplitResult;
}

export interface RankedState {
  readonly runId: string;
  readonly mode: GameModeId | "daily";
  readonly variant: string;
  readonly status: "playing" | "complete";
  readonly startedAt: number | null;
  readonly serverNow: number;
  readonly endsAt: number | null;
  readonly index: number;
  readonly total: number;
  readonly score: number;
  readonly timeMs: number | null;
  readonly question: RankedQuestion | null;
  readonly plane?: PlaneState;
  readonly reaches?: readonly { readonly code: string; readonly seconds: number }[];
  readonly found?: readonly string[];
  readonly feedback?: string;
  readonly result?: RankedMoveResult;
  readonly hints?: number;
  readonly wrongAnswers?: number;
}

export interface RankedAction {
  readonly runId: string;
  readonly questionId?: string;
  readonly type: "answer" | "pin" | "place" | "line" | "input" | "skip" | "poll" | "hint" | "reveal" | "puzzle-piece" | "puzzle-check";
  readonly answer?: string;
  readonly auto?: boolean;
  readonly countryCode?: string;
  readonly dx?: number;
  readonly dy?: number;
  readonly lat?: number;
  readonly lng?: number;
  readonly x?: number;
  readonly y?: number;
  readonly line?: readonly [ProjectedPoint, ProjectedPoint];
  readonly input?: PlaneInput;
}

export async function rankedRequest<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), ...(signal ? { signal } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Your game could not be verified.");
  return data as T;
}
