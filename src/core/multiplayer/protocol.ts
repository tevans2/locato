import type { FinalResult, PublicPlayerState, PublicRoomState, PublicRoundState, RoundResult } from "./roomTypes";

export type ClientMessage =
  | { readonly type: "CREATE_ROOM"; readonly playerName: string; readonly modeId: string }
  | { readonly type: "JOIN_ROOM"; readonly roomCode: string; readonly playerName: string }
  | { readonly type: "LEAVE_ROOM" }
  | { readonly type: "SET_READY"; readonly ready: boolean }
  | { readonly type: "START_GAME" }
  | { readonly type: "SUBMIT_ANSWER"; readonly answer: string; readonly clientSentAt: number }
  | { readonly type: "REQUEST_HINT" };

export type ServerMessage =
  | { readonly type: "ROOM_SNAPSHOT"; readonly room: PublicRoomState }
  | { readonly type: "PLAYER_JOINED"; readonly player: PublicPlayerState }
  | { readonly type: "PLAYER_LEFT"; readonly playerId: string }
  | { readonly type: "GAME_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ROUND_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ANSWER_ACCEPTED"; readonly playerId: string; readonly points: number }
  | { readonly type: "ANSWER_REJECTED"; readonly reason: string }
  | { readonly type: "ROUND_ENDED"; readonly countryCode: string; readonly countryName: string; readonly results: readonly RoundResult[] }
  | { readonly type: "GAME_COMPLETED"; readonly results: readonly FinalResult[] }
  | { readonly type: "ERROR"; readonly code: string; readonly message: string };

export type TransportStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface MultiplayerTransport {
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly send: (message: ClientMessage) => void;
  readonly onMessage: (handler: (message: ServerMessage) => void) => () => void;
  readonly onStatusChange: (handler: (status: TransportStatus) => void) => () => void;
}
