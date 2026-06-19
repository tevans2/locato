export type PlayerId = string;
export type RoomCode = string;

export interface PublicPlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly score: number;
  readonly streak: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
}

export interface PublicPromptContent {
  readonly kind: "image" | "text" | "map-click" | "map-highlight" | "flag-colors" | "maptap-globe";
  readonly value: string;
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
}

export interface PublicRoomState {
  readonly roomCode: RoomCode;
  readonly hostPlayerId: PlayerId;
  readonly categoryIds: readonly string[];
  readonly settings: PublicRoomSettings;
  readonly status: "lobby" | "playing" | "round-result" | "complete";
  readonly players: readonly PublicPlayerState[];
  readonly round: PublicRoundState | null;
  // Skip votes for the active round. When every connected player has voted, the server reveals
  // the answer and advances using the normal round-result flow.
  readonly skipVotes: readonly PlayerId[];
  readonly skipRequired: number;
  // Start/end of the current time-boxed phase, in server epoch ms. During "playing"
  // this tracks the live round deadline; during "round-result" it tracks the gap until
  // the next round. Null when the phase has no deadline (lobby/complete/untimed round).
  readonly phaseStartedAt: number | null;
  readonly phaseEndsAt: number | null;
}

export interface RoundResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly correct: boolean;
  readonly points: number;
  readonly answeredAt: number | null;
  readonly guess: string | null;
}

export interface MapTapRoundResult {
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
