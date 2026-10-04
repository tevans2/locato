import type { FlagPool } from "../flagPools";
import type { MapTapCategory } from "../maptap/types";
import type { FinalResult, FlyoverPlanePosition, FlyoverProgressEvent, GeoGuessrRoundResult, MapTapRoundResult, PublicPlayerState, PublicRoomState, PublicRoundState, RoundResult } from "./roomTypes";

export type ClientMessage =
  | { readonly type: "CREATE_ROOM"; readonly playerName: string; readonly avatarEmoji?: string; readonly categoryIds: readonly string[]; readonly roundLimit?: number; readonly roundDurationMs?: number; readonly flagPool?: FlagPool; readonly mapTapCategories?: readonly MapTapCategory[] }

  | { readonly type: "JOIN_ROOM"; readonly roomCode: string; readonly playerName: string; readonly avatarEmoji?: string }
  | { readonly type: "REJOIN_ROOM"; readonly roomCode: string; readonly playerId: string; readonly sessionToken: string }
  | { readonly type: "LEAVE_ROOM" }
  | { readonly type: "SET_ROOM_OPTIONS"; readonly categoryIds: readonly string[]; readonly roundLimit?: number; readonly roundDurationMs?: number; readonly flagPool?: FlagPool; readonly mapTapCategories?: readonly MapTapCategory[] }

  | { readonly type: "START_GAME" }
  /** Host, after a game: start the next one straight away with the same players and settings. */
  | { readonly type: "PLAY_AGAIN" }
  /** Host, after a game: back to the lobby to change settings before the next one. */
  | { readonly type: "RETURN_TO_LOBBY" }
  | { readonly type: "SUBMIT_ANSWER"; readonly answer: string; readonly clientSentAt: number }
  | { readonly type: "SUBMIT_MAPTAP_GUESS"; readonly lat: number; readonly lng: number; readonly clientSentAt: number }
  | { readonly type: "SUBMIT_GEOGUESSR_GUESS"; readonly lat: number; readonly lng: number; readonly clientSentAt: number }
  | { readonly type: "FLYOVER_POSITION"; readonly x: number; readonly y: number; readonly heading: number }
  | { readonly type: "FLYOVER_INPUT"; readonly turn: number; readonly towards?: number | null; readonly boost?: boolean }
  | { readonly type: "FLYOVER_REACHED"; readonly index: number; readonly x: number; readonly y: number; readonly clientSentAt: number }
  | { readonly type: "FLYOVER_SKIP"; readonly index: number }
  | { readonly type: "VOTE_SKIP" }
  | { readonly type: "SEND_CHAT_MESSAGE"; readonly text: string }
  | { readonly type: "REQUEST_HINT" };

export type ServerMessage =
  | { readonly type: "SESSION_ASSIGNED"; readonly playerId: string; readonly roomCode: string; readonly sessionToken: string }
  | { readonly type: "ROOM_SNAPSHOT"; readonly room: PublicRoomState }
  | { readonly type: "PLAYER_JOINED"; readonly player: PublicPlayerState }
  | { readonly type: "PLAYER_LEFT"; readonly playerId: string; readonly name: string }
  | { readonly type: "GAME_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ROUND_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ANSWER_ACCEPTED"; readonly playerId: string; readonly points: number }
  | { readonly type: "ANSWER_REJECTED"; readonly reason: string }
  | { readonly type: "ROUND_ENDED"; readonly answer: string; readonly results: readonly RoundResult[] }
  | { readonly type: "MAPTAP_ROUND_ENDED"; readonly targetName: string; readonly targetLat: number; readonly targetLng: number; readonly wikiSlug: string; readonly results: readonly MapTapRoundResult[] }
  | { readonly type: "GEOGUESSR_ROUND_ENDED"; readonly countryName: string; readonly targetLat: number; readonly targetLng: number; readonly results: readonly GeoGuessrRoundResult[] }
  | { readonly type: "FLYOVER_PLANES"; readonly planes: readonly FlyoverPlanePosition[] }
  /**
   * A racer moved along the route: "reached" scores, "skipped" doesn't, and "sync" goes to one
   * player only, correcting a claim the server turned down.
   */
  | { readonly type: "FLYOVER_PROGRESS"; readonly playerId: string; readonly index: number; readonly score: number; readonly event: FlyoverProgressEvent; readonly target?: string | null }
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
