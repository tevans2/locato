import { parseJsonMessage, parseServerMessage } from "./messageValidation";
import type { ClientMessage, MultiplayerTransport, ServerMessage, TransportStatus } from "./protocol";

const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;

export function resolveDefaultWebSocketUrl(location: Pick<Location, "host" | "protocol">): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export function createWebSocketMultiplayerTransport(url: string): MultiplayerTransport {
  let socket: WebSocket | null = null;
  let status: TransportStatus = "idle";
  let intentionalClose = false;
  let everConnected = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();

  function setStatus(nextStatus: TransportStatus): void {
    if (status === nextStatus) return;
    status = nextStatus;
    for (const handler of statusHandlers) handler(status);
  }

  function emit(message: ServerMessage): void {
    for (const handler of messageHandlers) handler(message);
  }

  function emitProtocolError(code: string, message: string): void {
    emit({ type: "ERROR", code, message });
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function handleServerData(data: unknown): void {
    if (typeof data !== "string") {
      emitProtocolError("invalid-frame", "Server sent a non-text message.");
      return;
    }

    const json = parseJsonMessage(data);
    if (!json.ok) {
      emitProtocolError(json.code, json.message);
      return;
    }

    const parsed = parseServerMessage(json.message);
    if (!parsed.ok) {
      emitProtocolError(parsed.code, parsed.message);
      return;
    }

    emit(parsed.message);
  }

  // Opens a socket and wires its lifecycle. `onOpen`/`onError` resolve the initial connect()
  // promise only; reconnect attempts pass neither and recover silently via status changes.
  function openSocket(onOpen?: () => void, onError?: () => void): void {
    const nextSocket = new WebSocket(url);
    socket = nextSocket;

    nextSocket.addEventListener(
      "open",
      () => {
        everConnected = true;
        reconnectAttempts = 0;
        setStatus("connected");
        onOpen?.();
      },
      { once: true },
    );

    nextSocket.addEventListener("message", (event) => handleServerData(event.data));

    nextSocket.addEventListener(
      "error",
      () => {
        if (!everConnected) {
          setStatus("error");
          onError?.();
        }
      },
      { once: true },
    );

    nextSocket.addEventListener("close", () => {
      if (socket === nextSocket) socket = null;
      if (intentionalClose) {
        setStatus("disconnected");
        return;
      }
      // Only auto-reconnect a connection that previously succeeded; an initial failure is
      // surfaced to the caller through the rejected connect() promise instead of looping.
      if (everConnected) scheduleReconnect();
    });
  }

  function scheduleReconnect(): void {
    clearReconnectTimer();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setStatus("error");
      return;
    }

    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    reconnectAttempts += 1;
    setStatus("connecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  return {
    connect: () => {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return Promise.resolve();

      intentionalClose = false;
      everConnected = false;
      reconnectAttempts = 0;
      clearReconnectTimer();
      setStatus("connecting");

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      openSocket(resolve, () => reject(new Error("Unable to connect to multiplayer server.")));
      return promise;
    },
    disconnect: () => {
      intentionalClose = true;
      everConnected = false;
      clearReconnectTimer();
      const activeSocket = socket;
      socket = null;
      if (activeSocket && activeSocket.readyState !== WebSocket.CLOSED) activeSocket.close(1000, "Client disconnected");
      setStatus("disconnected");
    },
    send: (message: ClientMessage) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        emitProtocolError("not-connected", "Connect to multiplayer before sending messages.");
        return;
      }
      socket.send(JSON.stringify(message));
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
