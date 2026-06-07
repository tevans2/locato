import type { ClientMessage, MultiplayerTransport, ServerMessage, TransportStatus } from "./protocol";
import type { PublicPlayerState, PublicRoomState, PublicRoundState } from "./roomTypes";

const HOST_PLAYER_ID = "host";
const RIVAL_PLAYER_ID = "rival";
const DEMO_ROOM_CODE = "PIN42";
const DEMO_SESSION_TOKEN = "demo-session";
const DEMO_ROUND_MS = 30_000;
const DEMO_RESULT_MS = 2_000;

function createPlayer(id: string, name: string, ready: boolean): PublicPlayerState {
  return { id, name, connected: true, ready, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 };
}

export function createMockMultiplayerTransport(): MultiplayerTransport {
  let status: TransportStatus = "idle";
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();
  let assignedPlayerId = HOST_PLAYER_ID;
  let room: PublicRoomState = {
    roomCode: DEMO_ROOM_CODE,
    hostPlayerId: HOST_PLAYER_ID,
    modeId: "classic",
    status: "lobby",
    players: [createPlayer(HOST_PLAYER_ID, "You", false), createPlayer(RIVAL_PLAYER_ID, "Rival", true)],
    round: null,
    phaseStartedAt: null,
    phaseEndsAt: null,
  };

  function setStatus(nextStatus: TransportStatus): void {
    status = nextStatus;
    for (const handler of statusHandlers) handler(status);
  }

  function emit(message: ServerMessage): void {
    for (const handler of messageHandlers) handler(message);
  }

  function assign(playerId: string): void {
    assignedPlayerId = playerId;
    emit({ type: "SESSION_ASSIGNED", playerId: assignedPlayerId, roomCode: room.roomCode, sessionToken: DEMO_SESSION_TOKEN });
  }

  function emitSnapshot(): void {
    emit({ type: "ROOM_SNAPSHOT", room });
  }

  function updateAssignedPlayer(update: (player: PublicPlayerState) => PublicPlayerState): void {
    room = { ...room, players: room.players.map((player) => (player.id === assignedPlayerId ? update(player) : player)) };
  }

  return {
    connect: async () => {
      setStatus("connecting");
      await Promise.resolve();
      setStatus("connected");
      assign(assignedPlayerId);
      emitSnapshot();
    },
    disconnect: () => setStatus("disconnected"),
    send: (message: ClientMessage) => {
      if (message.type === "CREATE_ROOM") {
        assignedPlayerId = HOST_PLAYER_ID;
        room = {
          roomCode: DEMO_ROOM_CODE,
          hostPlayerId: HOST_PLAYER_ID,
          modeId: message.modeId,
          status: "lobby",
          players: [createPlayer(HOST_PLAYER_ID, message.playerName, false), createPlayer(RIVAL_PLAYER_ID, "Rival", true)],
          round: null,
          phaseStartedAt: null,
          phaseEndsAt: null,
        };
        assign(HOST_PLAYER_ID);
        emitSnapshot();
        return;
      }

      if (message.type === "JOIN_ROOM") {
        assignedPlayerId = "guest";
        room = {
          roomCode: message.roomCode || DEMO_ROOM_CODE,
          hostPlayerId: HOST_PLAYER_ID,
          modeId: "classic",
          status: "lobby",
          players: [createPlayer(HOST_PLAYER_ID, "Host", true), createPlayer("guest", message.playerName, false)],
          round: null,
          phaseStartedAt: null,
          phaseEndsAt: null,
        };
        assign("guest");
        emitSnapshot();
        return;
      }

      if (message.type === "REJOIN_ROOM") {
        assign(assignedPlayerId);
        emitSnapshot();
        return;
      }

      if (message.type === "LEAVE_ROOM") {
        room = { ...room, players: room.players.filter((player) => player.id !== assignedPlayerId) };
        emit({ type: "PLAYER_LEFT", playerId: assignedPlayerId, name: "You" });
        emitSnapshot();
        return;
      }

      if (message.type === "SET_READY") {
        updateAssignedPlayer((player) => ({ ...player, ready: message.ready }));
        emitSnapshot();
        return;
      }

      if (message.type === "START_GAME") {
        const startedAt = Date.now();
        const round: PublicRoundState = { roundNumber: 1, flagSrc: "assets/flags/jp.svg", startedAt, endsAt: startedAt + DEMO_ROUND_MS };
        room = { ...room, status: "playing", round, phaseStartedAt: startedAt, phaseEndsAt: round.endsAt };
        emit({ type: "GAME_STARTED", round });
        emitSnapshot();
        return;
      }

      if (message.type === "SUBMIT_ANSWER") {
        if (message.answer.trim().toLowerCase() !== "japan") {
          updateAssignedPlayer((player) => ({ ...player, wrongAnswers: player.wrongAnswers + 1, streak: 0 }));
          emit({ type: "ANSWER_REJECTED", reason: "Not quite. Try again before the round ends." });
          return;
        }

        const points = 120;
        const closedAt = Date.now();
        updateAssignedPlayer((player) => ({ ...player, score: player.score + points, streak: player.streak + 1, correctAnswers: player.correctAnswers + 1 }));
        room = { ...room, status: "round-result", phaseStartedAt: closedAt, phaseEndsAt: closedAt + DEMO_RESULT_MS };
        emit({ type: "ANSWER_ACCEPTED", playerId: assignedPlayerId, points });
        emit({
          type: "ROUND_ENDED",
          countryCode: "JP",
          countryName: "Japan",
          results: room.players.map((player) => ({ playerId: player.id, correct: player.id === assignedPlayerId, points: player.id === assignedPlayerId ? points : 0, answeredAt: player.id === assignedPlayerId ? closedAt : null })),
        });
        emitSnapshot();
      }
    },
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onStatusChange: (handler) => {
      statusHandlers.add(handler);
      handler(status);
      return () => statusHandlers.delete(handler);
    },
  };
}
