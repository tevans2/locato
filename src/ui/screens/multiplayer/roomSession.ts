/*
 * One player's connection to one room: the transport, reconnect credentials, and everything the
 * server has told us. No DOM: the multiplayer screen renders `state` and plays the sounds.
 */

import type { ClientMessage, FinalResult, MultiplayerTransport, PublicRoomState, PublicRoundState, RoundResult, ServerMessage, TransportStatus } from "../../../core/multiplayer";
import type { MapTapMultiplayerReveal } from "../../components/MultiplayerMapTapGameView";
import type { GeoGuessrMultiplayerReveal } from "../../components/MultiplayerGeoGuessrGameView";
import { MULTIPLAYER_SESSION_KEY } from "../../../core/multiplayer/localPlayer";

export interface StoredSession {
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

export interface QuizReveal {
  readonly answer: string;
  readonly results: readonly RoundResult[];
}

export interface RoomNotice {
  readonly tone: "info" | "error";
  readonly text: string;
}

export interface RoomSessionState {
  readonly status: TransportStatus;
  readonly room: PublicRoomState | null;
  readonly localPlayerId: string | null;
  readonly round: PublicRoundState | null;
  readonly quizReveal: QuizReveal | null;
  readonly mapTapReveal: MapTapMultiplayerReveal | null;
  readonly geoGuessrReveal: GeoGuessrMultiplayerReveal | null;
  readonly finalResults: readonly FinalResult[] | null;
  /** The in-game line under the prompt ("Ana took the round."). */
  readonly feedback: string;
  /** Something to tell the player outside the game: a failed join, a lost connection, a new host. */
  readonly notice: RoomNotice | null;
  /** A create / join / rejoin on its way to the server. */
  readonly pending: "create" | "join" | "rejoin" | null;
}

export interface CreateRoomRequest {
  readonly playerName: string;
  readonly avatarEmoji: string;
  readonly categoryIds: readonly string[];
}

export interface RoomSessionOptions {
  readonly createTransport: () => MultiplayerTransport;
  /** Re-render. Called after every state change. */
  readonly onChange: (state: RoomSessionState) => void;
  /** Every server message, before it is applied: sounds, stats, Flyover's live traffic. */
  readonly onServerMessage?: (message: ServerMessage, before: RoomSessionState) => void;
  /** The room this tab is seated in changed (null = none), so the URL can carry `?room=CODE`. */
  readonly onRoomCodeChange?: (roomCode: string | null) => void;
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

export interface RoomSession {
  readonly state: () => RoomSessionState;
  readonly create: (request: CreateRoomRequest) => void;
  readonly join: (roomCode: string, playerName: string, avatarEmoji: string) => void;
  /** Reclaim a seat after a reload (or a lost connection) with stored credentials. */
  readonly resume: (session: StoredSession) => void;
  /** Leave for good: tells the server, forgets the seat. */
  readonly leave: () => void;
  readonly send: (message: ClientMessage) => void;
  /** After the connection gave up: try the seat again. */
  readonly retry: () => void;
  readonly dismissNotice: () => void;
  readonly destroy: () => void;
}

const IDLE: RoomSessionState = {
  status: "idle",
  room: null,
  localPlayerId: null,
  round: null,
  quizReveal: null,
  mapTapReveal: null,
  geoGuessrReveal: null,
  finalResults: null,
  feedback: "",
  notice: null,
  pending: null,
};

const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";

export function readStoredSession(storage: RoomSessionOptions["storage"]): StoredSession | null {
  try {
    const raw = storage?.getItem(MULTIPLAYER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.roomCode !== "string" || typeof parsed.playerId !== "string" || typeof parsed.sessionToken !== "string") return null;
    return { roomCode: parsed.roomCode, playerId: parsed.playerId, sessionToken: parsed.sessionToken };
  } catch {
    return null;
  }
}

export function clearStoredSession(storage: RoomSessionOptions["storage"]): void {
  try {
    storage?.removeItem(MULTIPLAYER_SESSION_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

function playerName(room: PublicRoomState | null, playerId: string): string {
  return room?.players.find((player) => player.id === playerId)?.name ?? "A player";
}

export function createRoomSession(options: RoomSessionOptions): RoomSession {
  let state: RoomSessionState = IDLE;
  let transport: MultiplayerTransport | null = null;
  let unbind: (() => void) | null = null;
  // Credentials for the seat we hold (or are reclaiming): a reconnect sends REJOIN_ROOM with them.
  let seat: StoredSession | null = null;
  let destroyed = false;

  function set(patch: Partial<RoomSessionState>): void {
    state = { ...state, ...patch };
    if (!destroyed) options.onChange(state);
  }

  function writeSeat(next: StoredSession | null): void {
    seat = next;
    try {
      if (next) options.storage?.setItem(MULTIPLAYER_SESSION_KEY, JSON.stringify(next));
      else options.storage?.removeItem(MULTIPLAYER_SESSION_KEY);
    } catch {
      // Private mode: a reload just can't reclaim the seat.
    }
  }

  function disconnect(): void {
    unbind?.();
    unbind = null;
    transport?.disconnect();
    transport = null;
  }

  /** Back to "not in a room", keeping (or setting) a notice for the home view. */
  function reset(notice: RoomNotice | null): void {
    disconnect();
    const hadRoom = state.room !== null || seat !== null;
    writeSeat(null);
    state = { ...IDLE, notice };
    if (hadRoom) options.onRoomCodeChange?.(null);
    if (!destroyed) options.onChange(state);
  }

  function connect(pending: NonNullable<RoomSessionState["pending"]>, afterConnect: () => void): void {
    disconnect();
    const next = options.createTransport();
    transport = next;
    const offMessage = next.onMessage(handleMessage);
    const offStatus = next.onStatusChange((status) => {
      // A reconnect lands here with credentials in hand: reclaim the seat automatically. The first
      // connect of a create/join has none yet, so it is left to `afterConnect`.
      if (status === "connected" && seat && state.pending !== "create" && state.pending !== "join") {
        next.send({ type: "REJOIN_ROOM", roomCode: seat.roomCode, playerId: seat.playerId, sessionToken: seat.sessionToken });
      }
      if (status === "error" && !state.room) {
        reset({ tone: "error", text: UNREACHABLE });
        return;
      }
      set({
        status,
        ...(status === "error" ? { notice: { tone: "error", text: "Lost the connection to the room." } } : {}),
        ...(status === "connected" && state.notice?.text === "Lost the connection to the room." ? { notice: null } : {}),
      });
    });
    unbind = () => {
      offMessage();
      offStatus();
    };
    set({ pending, notice: null });
    next.connect().then(
      () => {
        if (transport === next) afterConnect();
      },
      () => {
        if (transport === next) reset({ tone: "error", text: UNREACHABLE });
      },
    );
  }

  function handleMessage(message: ServerMessage): void {
    const before = state;
    options.onServerMessage?.(message, before);
    switch (message.type) {
      case "FLYOVER_PLANES":
      case "FLYOVER_PROGRESS":
        // Live traffic several times a second: the race view takes it directly.
        return;
      case "SESSION_ASSIGNED":
        writeSeat({ roomCode: message.roomCode, playerId: message.playerId, sessionToken: message.sessionToken });
        options.onRoomCodeChange?.(message.roomCode);
        set({ localPlayerId: message.playerId, pending: null });
        return;
      case "ROOM_SNAPSHOT": {
        const room = message.room;
        const previous = before.room;
        let notice = before.notice;
        if (previous && previous.roomCode === room.roomCode && previous.hostPlayerId !== room.hostPlayerId) {
          notice = { tone: "info", text: room.hostPlayerId === before.localPlayerId ? "You're the host now." : `${playerName(room, room.hostPlayerId)} is the host now.` };
        }
        set({
          room,
          round: room.round,
          notice,
          pending: null,
          // A new game (or the lobby) drops the last game's standings and reveals.
          ...(room.status === "lobby" ? { finalResults: null, quizReveal: null, mapTapReveal: null, geoGuessrReveal: null, feedback: "" } : {}),
          ...(room.status === "playing" ? { quizReveal: null } : {}),
        });
        return;
      }
      case "GAME_STARTED":
      case "ROUND_STARTED":
        set({
          round: message.round,
          quizReveal: null,
          mapTapReveal: null,
          geoGuessrReveal: null,
          finalResults: null,
          feedback: message.round.prompt.kind === "flyover-flight" ? "The race is on." : `Round ${message.round.roundNumber} is live.`,
        });
        return;
      case "ANSWER_ACCEPTED":
        set({ feedback: message.playerId === before.localPlayerId ? `You took the round for ${message.points} points.` : `${playerName(before.room, message.playerId)} took the round.` });
        return;
      case "ANSWER_REJECTED":
        set({ feedback: message.reason });
        return;
      case "ROUND_ENDED": {
        const winner = message.results.find((result) => result.correct);
        const mine = message.results.find((result) => result.playerId === before.localPlayerId);
        const feedback = winner
          ? winner.playerId === before.localPlayerId ? `You got it: ${message.answer}.` : `${winner.name} got it: ${message.answer}.`
          : mine?.guess ? `It was ${message.answer}. Your last guess was ${mine.guess}.` : `It was ${message.answer}. Nobody got it.`;
        set({ quizReveal: { answer: message.answer, results: message.results }, feedback });
        return;
      }
      case "MAPTAP_ROUND_ENDED": {
        const top = message.results[0];
        set({
          mapTapReveal: { targetName: message.targetName, targetLat: message.targetLat, targetLng: message.targetLng, wikiSlug: message.wikiSlug, results: message.results },
          feedback: top?.guess ? `${message.targetName}: ${top.name} was closest.` : `${message.targetName}: nobody guessed.`,
        });
        return;
      }
      case "GEOGUESSR_ROUND_ENDED": {
        const top = message.results[0];
        set({
          geoGuessrReveal: { countryName: message.countryName, targetLat: message.targetLat, targetLng: message.targetLng, results: message.results },
          feedback: top?.guess ? `${message.countryName}: ${top.name} was closest.` : `${message.countryName}: nobody guessed.`,
        });
        return;
      }
      case "GAME_COMPLETED":
        set({ finalResults: message.results, feedback: "" });
        return;
      case "PLAYER_JOINED":
        if (message.player.id !== before.localPlayerId) set({ notice: { tone: "info", text: `${message.player.name} joined${message.player.spectator ? " and is watching" : ""}.` } });
        return;
      case "PLAYER_LEFT":
        set({ notice: { tone: "info", text: `${message.name} left.` } });
        return;
      case "ERROR":
        // A failed (re)join, or the room going away, drops us back to the start.
        if (message.code === "session-expired" || message.code === "room-not-found" || (!before.room && before.pending)) {
          reset({ tone: "error", text: message.message });
          return;
        }
        // Mid-game slips (a rejected guess) belong under the prompt, not in a banner.
        if (before.room && before.room.status !== "lobby" && before.room.status !== "complete") set({ feedback: message.message });
        else set({ notice: { tone: "error", text: message.message } });
        return;
    }
  }

  return {
    state: () => state,
    create: (request) => {
      writeSeat(null);
      connect("create", () => transport?.send({ type: "CREATE_ROOM", playerName: request.playerName, avatarEmoji: request.avatarEmoji, categoryIds: request.categoryIds }));
    },
    join: (roomCode, name, avatarEmoji) => {
      writeSeat(null);
      connect("join", () => transport?.send({ type: "JOIN_ROOM", roomCode, playerName: name, avatarEmoji }));
    },
    resume: (stored) => {
      seat = stored;
      // The status handler sends REJOIN_ROOM as soon as the socket opens.
      connect("rejoin", () => undefined);
    },
    leave: () => {
      transport?.send({ type: "LEAVE_ROOM" });
      reset(null);
    },
    send: (message) => transport?.send(message),
    retry: () => {
      if (seat) connect("rejoin", () => undefined);
    },
    dismissNotice: () => set({ notice: null }),
    destroy: () => {
      destroyed = true;
      disconnect();
    },
  };
}
