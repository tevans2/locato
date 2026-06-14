import type { ClientMessage, MultiplayerTransport, ServerMessage, TransportStatus } from "./protocol";
import type { FinalResult, PublicPlayerState, PublicPromptContent, PublicRoomState, PublicRoundState } from "./roomTypes";

const HOST_PLAYER_ID = "host";
const RIVAL_PLAYER_ID = "rival";
const DEMO_ROOM_CODE = "PIN42";
const DEMO_SESSION_TOKEN = "demo-session";
const DEMO_ROUND_MS = 30_000;
const DEMO_RESULT_MS = 2_000;

// A tiny scripted game so the local demo exercises the full arc — rounds, the intermission
// gap, and the end-of-game leaderboard — without a server.
// A tiny scripted, category-mixed game: rounds cover flags, country outlines, and ISO codes —
// proving prompt categories interleave in one deck, plus the intermission gap and leaderboard.
const DEMO_ROUNDS: ReadonlyArray<{ readonly prompt: PublicPromptContent; readonly answer: string; readonly reveal: string }> = [
  { prompt: { kind: "image", value: "assets/flags/jp.svg" }, answer: "japan", reveal: "Japan" },
  { prompt: { kind: "image", value: "assets/country-shapes/ca.svg" }, answer: "canada", reveal: "Canada" },
  { prompt: { kind: "text", value: "BR" }, answer: "brazil", reveal: "Brazil (BR)" },
  { prompt: { kind: "map-click", value: "Japan" }, answer: "jp", reveal: "Japan" },
  { prompt: { kind: "map-highlight", value: "CA" }, answer: "canada", reveal: "Canada" },
];

function createPlayer(id: string, name: string, ready: boolean): PublicPlayerState {
  return { id, name, connected: true, ready, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 };
}

export function createMockMultiplayerTransport(): MultiplayerTransport {
  let status: TransportStatus = "idle";
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();
  let assignedPlayerId = HOST_PLAYER_ID;
  let roundIndex = -1;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;
  let room: PublicRoomState = lobbyRoom(["flags", "shapes", "codes", "pick-country"], "You");

  function lobbyRoom(categoryIds: readonly string[], hostName: string): PublicRoomState {
    return {
      roomCode: DEMO_ROOM_CODE,
      hostPlayerId: HOST_PLAYER_ID,
      categoryIds: [...categoryIds],
      settings: { roundLimit: DEMO_ROUNDS.length, roundDurationMs: DEMO_ROUND_MS },
      status: "lobby",
      players: [createPlayer(HOST_PLAYER_ID, hostName, false), createPlayer(RIVAL_PLAYER_ID, "Rival", true)],
      round: null,
      skipVotes: [],
      skipRequired: 0,
      phaseStartedAt: null,
      phaseEndsAt: null,
    };
  }

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

  function clearAdvanceTimer(): void {
    if (advanceTimer !== null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  function beginRound(index: number): void {
    roundIndex = index;
    const startedAt = Date.now();
    const data = DEMO_ROUNDS[index];
    if (!data) return;
    const round: PublicRoundState = { roundNumber: index + 1, prompt: data.prompt, startedAt, endsAt: startedAt + DEMO_ROUND_MS };
    room = { ...room, status: "playing", round, skipVotes: [], skipRequired: room.players.filter((player) => player.connected).length, phaseStartedAt: startedAt, phaseEndsAt: round.endsAt };
    emit({ type: index === 0 ? "GAME_STARTED" : "ROUND_STARTED", round });
    emitSnapshot();
  }

  function finalStandings(): readonly FinalResult[] {
    return [...room.players]
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .map((player, index) => ({ playerId: player.id, name: player.name, rank: index + 1, score: player.score, correctAnswers: player.correctAnswers, wrongAnswers: player.wrongAnswers }));
  }

  function completeGame(): void {
    room = { ...room, status: "complete", round: null, skipVotes: [], skipRequired: 0, phaseStartedAt: null, phaseEndsAt: null };
    emit({ type: "GAME_COMPLETED", results: finalStandings() });
    emitSnapshot();
  }

  return {
    connect: async () => {
      setStatus("connecting");
      await Promise.resolve();
      setStatus("connected");
      assign(assignedPlayerId);
      emitSnapshot();
    },
    disconnect: () => {
      clearAdvanceTimer();
      setStatus("disconnected");
    },
    send: (message: ClientMessage) => {
      if (message.type === "CREATE_ROOM") {
        clearAdvanceTimer();
        roundIndex = -1;
        assignedPlayerId = HOST_PLAYER_ID;
        room = lobbyRoom(message.categoryIds, message.playerName);
        room = { ...room, settings: { roundLimit: message.roundLimit ?? DEMO_ROUNDS.length, roundDurationMs: message.roundDurationMs ?? DEMO_ROUND_MS } };
        assign(HOST_PLAYER_ID);
        emitSnapshot();
        return;
      }

      if (message.type === "JOIN_ROOM") {
        clearAdvanceTimer();
        roundIndex = -1;
        assignedPlayerId = "guest";
        room = {
          roomCode: message.roomCode || DEMO_ROOM_CODE,
          hostPlayerId: HOST_PLAYER_ID,
          categoryIds: ["flags", "shapes", "codes", "pick-country"],
          settings: { roundLimit: DEMO_ROUNDS.length, roundDurationMs: DEMO_ROUND_MS },
          status: "lobby",
          players: [createPlayer(HOST_PLAYER_ID, "Host", true), createPlayer("guest", message.playerName, false)],
          round: null,
          phaseStartedAt: null,
          skipVotes: [],
          skipRequired: 0,
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
        clearAdvanceTimer();
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
        clearAdvanceTimer();
        room = { ...room, players: room.players.map((player) => ({ ...player, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 })) };
        beginRound(0);
        return;
      }

      if (message.type === "PLAY_AGAIN") {
        // Mirror the server: a rematch returns to the lobby (not an instant restart). Keep the
        // scripted rival ready so the single-human demo can immediately ready up and start again.
        clearAdvanceTimer();
        roundIndex = -1;
        room = {
          ...room,
          status: "lobby",
          round: null,
          skipVotes: [],
          skipRequired: 0,
          phaseStartedAt: null,
          phaseEndsAt: null,
          players: room.players.map((player) => ({ ...player, ready: player.id !== assignedPlayerId, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 })),
        };
        emitSnapshot();
        return;
      }

      if (message.type === "SUBMIT_ANSWER") {
        const data = DEMO_ROUNDS[roundIndex];
        if (!data || room.status !== "playing") return;

        if (message.answer.trim().toLowerCase() !== data.answer) {
          updateAssignedPlayer((player) => ({ ...player, wrongAnswers: player.wrongAnswers + 1, streak: 0 }));
          emit({ type: "ANSWER_REJECTED", reason: "Not quite. Try again before the round ends." });
          return;
        }

        const points = 120 - roundIndex * 10;
        const closedAt = Date.now();
        updateAssignedPlayer((player) => ({ ...player, score: player.score + points, streak: player.streak + 1, correctAnswers: player.correctAnswers + 1 }));
        room = { ...room, status: "round-result", skipVotes: [], skipRequired: 0, phaseStartedAt: closedAt, phaseEndsAt: closedAt + DEMO_RESULT_MS };
        emit({ type: "ANSWER_ACCEPTED", playerId: assignedPlayerId, points });
        emit({
          type: "ROUND_ENDED",
          answer: data.reveal,
          results: room.players.map((player) => ({
            playerId: player.id,
            name: player.name,
            correct: player.id === assignedPlayerId,
            points: player.id === assignedPlayerId ? points : 0,
            answeredAt: player.id === assignedPlayerId ? closedAt : null,
            guess: player.id === assignedPlayerId ? message.answer.trim() : null,
          })),
        });
        emitSnapshot();

        const nextIndex = roundIndex + 1;
        clearAdvanceTimer();
        advanceTimer = setTimeout(() => {
          advanceTimer = null;
          if (nextIndex < DEMO_ROUNDS.length) beginRound(nextIndex);
          else completeGame();
        }, DEMO_RESULT_MS);
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
