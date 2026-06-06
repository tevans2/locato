import { createMockMultiplayerTransport, type MultiplayerTransport, type PublicRoomState, type ServerMessage, type TransportStatus } from "../../core/multiplayer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface MultiplayerLobbyScreenOptions {
  readonly onBack: () => void;
  readonly transport?: MultiplayerTransport;
}

function renderRoom(roomSlot: HTMLElement, room: PublicRoomState | null): void {
  if (!room) {
    roomSlot.replaceChildren(el("p", { className: "muted", text: "Connect to preview a room." }));
    return;
  }

  roomSlot.replaceChildren(
    el("div", { className: "room-code", children: [el("span", { text: "Room" }), el("strong", { text: room.roomCode })] }),
    el("div", {
      className: "player-list",
      children: room.players.map((player) =>
        el("div", {
          className: "player-row",
          children: [el("span", { text: player.name }), el("strong", { text: player.ready ? "Ready" : "Not ready" })],
        }),
      ),
    }),
  );
}

export function createMultiplayerLobbyScreen(options: MultiplayerLobbyScreenOptions): Screen {
  const controller = new AbortController();
  const transport = options.transport ?? createMockMultiplayerTransport();
  const status = el("span", { className: "connection-status", text: "Idle" });
  const roomSlot = el("div", { className: "room-panel" });
  const readyButton = el("button", { className: "secondary-action", text: "Toggle ready" });
  const startButton = el("button", { className: "primary-action", text: "Start mock round" });
  let ready = false;
  let removeMessageHandler: () => void = () => undefined;
  let removeStatusHandler: () => void = () => undefined;

  function setStatus(nextStatus: TransportStatus): void {
    status.textContent = nextStatus;
  }

  function handleMessage(message: ServerMessage): void {
    if (message.type === "ROOM_SNAPSHOT") renderRoom(roomSlot, message.room);
    if (message.type === "GAME_STARTED") {
      roomSlot.append(el("p", { className: "feedback good", text: `Mock round ${message.round.roundNumber} started. Real server integration will validate answers authoritatively.` }));
    }
    if (message.type === "ANSWER_REJECTED") roomSlot.append(el("p", { className: "feedback bad", text: message.reason }));
  }

  readyButton.addEventListener(
    "click",
    () => {
      ready = !ready;
      transport.send({ type: "SET_READY", ready });
    },
    { signal: controller.signal },
  );

  startButton.addEventListener("click", () => transport.send({ type: "START_GAME" }), { signal: controller.signal });

  const element = el("section", {
    className: "multiplayer-screen",
    children: [
      el("button", { className: "ghost-action", text: "← Home", on: { click: options.onBack } }),
      el("div", { className: "screen-heading", children: [el("p", { className: "eyebrow", text: "Multiplayer foundation" }), el("h1", { text: "Room preview" }), el("p", { className: "lede", text: "This shell is wired to a typed mock transport. The real WebSocket server can plug into the same protocol without changing UI contracts." })] }),
      el("div", { className: "connection-card", children: [el("span", { text: "Connection" }), status] }),
      roomSlot,
      el("div", { className: "actions", children: [readyButton, startButton] }),
    ],
  });

  removeMessageHandler = transport.onMessage(handleMessage);
  removeStatusHandler = transport.onStatusChange(setStatus);
  renderRoom(roomSlot, null);
  void transport.connect();

  return {
    element,
    destroy: () => {
      controller.abort();
      removeMessageHandler();
      removeStatusHandler();
      transport.disconnect();
    },
  };
}
