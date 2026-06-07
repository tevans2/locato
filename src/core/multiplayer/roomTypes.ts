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

export interface PublicRoundState {
  readonly roundNumber: number;
  readonly flagSrc: string;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

export interface PublicRoomState {
  readonly roomCode: RoomCode;
  readonly hostPlayerId: PlayerId;
  readonly modeId: string;
  readonly status: "lobby" | "playing" | "round-result" | "complete";
  readonly players: readonly PublicPlayerState[];
  readonly round: PublicRoundState | null;
  // Start/end of the current time-boxed phase, in server epoch ms. During "playing"
  // this tracks the live round deadline; during "round-result" it tracks the gap until
  // the next round. Null when the phase has no deadline (lobby/complete/untimed round).
  readonly phaseStartedAt: number | null;
  readonly phaseEndsAt: number | null;
}

export interface RoundResult {
  readonly playerId: PlayerId;
  readonly correct: boolean;
  readonly points: number;
  readonly answeredAt: number | null;
}

export interface FinalResult {
  readonly playerId: PlayerId;
  readonly rank: number;
  readonly score: number;
  readonly correctAnswers: number;
}
