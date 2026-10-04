import type { GameModeId } from "./gameModes";
import type { PlaneInput, PlaneState } from "./flyover";
import type { ProjectedPoint } from "./map";

/** Only the current challenge crosses the wire. Answers and queues stay on the server. */
export interface RankedQuestion {
  readonly id: string;
  readonly kind: "text" | "image" | "flag-colors" | "name-all" | "click" | "spot" | "puzzle" | "pin" | "street" | "split" | "flight";
  readonly text: string;
  readonly asset?: string;
  readonly paths?: readonly (readonly ProjectedPoint[])[];
  readonly frames?: readonly { readonly asset: string }[];
}

export interface RankedState {
  readonly runId: string;
  readonly mode: GameModeId | "daily";
  readonly variant: string;
  readonly status: "playing" | "complete";
  readonly startedAt: number;
  readonly serverNow: number;
  readonly endsAt: number | null;
  readonly index: number;
  readonly total: number;
  readonly score: number;
  readonly timeMs: number | null;
  readonly question: RankedQuestion | null;
  readonly plane?: PlaneState;
  readonly found?: readonly string[];
  readonly feedback?: string;
}

export interface RankedAction {
  readonly runId: string;
  readonly questionId?: string;
  readonly type: "answer" | "pin" | "place" | "line" | "input" | "skip" | "poll";
  readonly answer?: string;
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
