import type { ClientMessage, MultiplayerTransport, ServerMessage, TransportStatus } from "./protocol";
import type { PublicRoomState } from "./roomTypes";

export function createMockMultiplayerTransport(): MultiplayerTransport {
  let status: TransportStatus = "idle";
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();
  const room: PublicRoomState = {
    roomCode: "PIN42",
    hostPlayerId: "host",
    modeId: "classic",
    status: "lobby",
    players: [
      { id: "host", name: "You", connected: true, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 },
      { id: "rival", name: "Rival", connected: true, ready: true, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 },
    ],
    round: null,
  };

  function setStatus(nextStatus: TransportStatus): void {
    status = nextStatus;
    for (const handler of statusHandlers) handler(status);
  }

  function emit(message: ServerMessage): void {
    for (const handler of messageHandlers) handler(message);
  }

  return {
    connect: async () => {
      setStatus("connecting");
      await Promise.resolve();
      setStatus("connected");
      emit({ type: "ROOM_SNAPSHOT", room });
    },
    disconnect: () => setStatus("disconnected"),
    send: (message: ClientMessage) => {
      if (message.type === "SET_READY") {
        const updatedPlayers = room.players.map((player) => (player.id === "host" ? { ...player, ready: message.ready } : player));
        emit({ type: "ROOM_SNAPSHOT", room: { ...room, players: updatedPlayers } });
        return;
      }

      if (message.type === "START_GAME") {
        emit({ type: "GAME_STARTED", round: { roundNumber: 1, flagSrc: "assets/flags/jp.svg", startedAt: Date.now(), endsAt: null } });
        return;
      }

      if (message.type === "SUBMIT_ANSWER") {
        emit({ type: "ANSWER_REJECTED", reason: "Mock transport only previews the multiplayer shell." });
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
