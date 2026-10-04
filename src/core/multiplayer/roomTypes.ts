import type { MapTapCategory } from "../maptap/types";
import type { FlagPool } from "../flagPools";


export type PlayerId = string;
export type RoomCode = string;

/**
 * What a room plays. "quiz" races typed/clicked answers across a mix of prompt modes; the others
 * each play one mode their own way. The host can switch it in the lobby.
 */
export type RoomKind = "quiz" | "map-tap" | "geoguessr" | "flyover";

export const ROOM_KINDS: readonly RoomKind[] = ["quiz", "map-tap", "geoguessr", "flyover"];

export function isRoomKind(value: unknown): value is RoomKind {
  return typeof value === "string" && (ROOM_KINDS as readonly string[]).includes(value);
}

/** The room kind a category selection needs: an exclusive mode's own room, or the mixed quiz. */
export function roomKindForCategories(categoryIds: readonly string[]): RoomKind {
  const only = categoryIds.length === 1 ? categoryIds[0] : undefined;
  return only === "map-tap" || only === "geoguessr" || only === "flyover" ? only : "quiz";
}

export interface PublicPlayerState {
  readonly id: PlayerId;
  readonly name: string;
  /** The player's chosen avatar (one of AVATAR_OPTIONS); absent for clients that never sent one. */
  readonly avatarEmoji?: string;
  readonly connected: boolean;
  /** Joined while a game was running: watches it, and plays from the next game. */
  readonly spectator?: true;
  readonly score: number;
  readonly streak: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  /** Flyover: how far along the shared route this racer is (reached + skipped). */
  readonly routeIndex?: number;
}

export interface PublicPromptContent {
  readonly kind: "image" | "text" | "map-click" | "map-highlight" | "flag-colors" | "maptap-globe" | "geoguessr-streetview" | "flyover-flight";
  readonly value: string;
  /** "shape": the image is a white country outline (see PromptContent). */
  readonly presentation?: "shape" | "flag-colors";
}

export interface PublicRoundState {
  readonly roundNumber: number;
  readonly prompt: PublicPromptContent;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

export interface PublicRoomSettings {
  readonly roundLimit: number;
  readonly roundDurationMs: number;
  readonly mapTapCategories?: readonly MapTapCategory[];
  readonly flagPool?: FlagPool;

}

export interface PublicChatMessage {
  readonly id: string;
  readonly playerId: PlayerId;
  readonly playerName: string;
  readonly text: string;
  readonly sentAt: number;
}

export interface PublicRoomState {
  readonly roomCode: RoomCode;
  readonly kind: RoomKind;
  readonly hostPlayerId: PlayerId;
  readonly categoryIds: readonly string[];
  readonly settings: PublicRoomSettings;
  readonly status: "lobby" | "playing" | "round-result" | "complete";
  readonly players: readonly PublicPlayerState[];
  readonly round: PublicRoundState | null;
  // Skip votes for the active round. When every connected (non-spectating) player has voted, the server reveals
  // the answer and advances using the normal round-result flow.
  readonly skipVotes: readonly PlayerId[];
  readonly skipRequired: number;
  // Start/end of the current time-boxed phase, in server epoch ms. During "playing"
  // this tracks the live round deadline; during "round-result" it tracks the gap until
  // the next round. Null when the phase has no deadline (lobby/complete/untimed round).
  readonly phaseStartedAt: number | null;
  readonly phaseEndsAt: number | null;
  readonly chatMessages: readonly PublicChatMessage[];
}

export interface RoundResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly correct: boolean;
  readonly points: number;
  readonly answeredAt: number | null;
  /** The player's latest guess this round (the right one, for the winner). */
  readonly guess: string | null;
  /** How many answers they sent this round. */
  readonly attempts: number;
  /** Time from the round opening to their latest answer. */
  readonly elapsedMs: number | null;
}

export interface MapTapRoundResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly guess: { readonly lat: number; readonly lng: number } | null;
  readonly distanceKm: number | null;
  readonly score: number;
}

export interface GeoGuessrRoundResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly guess: { readonly lat: number; readonly lng: number } | null;
  readonly distanceKm: number | null;
  readonly score: number;
}

export interface FinalResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly rank: number;
  readonly score: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
}

/** The `flyover-flight` prompt value (JSON): where every plane takes off and the shared route. */
export interface FlyoverFlightPrompt {
  readonly start: { readonly x: number; readonly y: number; readonly heading: number };
  /** Only the first target. Each racer's next target is sent privately after server verification. */
  readonly target?: string | null;
  /** Legacy fixtures only; servers never publish a full route. */
  readonly route?: readonly string[];
}

export interface FlyoverPlanePosition {
  readonly playerId: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export type FlyoverProgressEvent = "reached" | "skipped" | "sync";
