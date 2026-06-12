import type { SocialServerMessage } from "./socialProtocol";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const HEARTBEAT_MS = 25000;

export interface SocialClient {
  connect(): void;
  disconnect(): void;
  // Subscribe to server-pushed social events. Returns an unsubscribe function.
  subscribe(listener: (message: SocialServerMessage) => void): () => void;
}

export function resolveSocialUrl(location: Pick<Location, "host" | "protocol">): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/social`;
}

const KNOWN_TYPES = new Set(["PRESENCE_SNAPSHOT", "PRESENCE", "FRIEND_REQUEST", "FRIEND_ACCEPTED", "FRIENDS_CHANGED", "GAME_INVITE"]);

function parse(data: unknown): SocialServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== "object" || value === null) return null;
    const type = (value as { type?: unknown }).type;
    return typeof type === "string" && KNOWN_TYPES.has(type) ? (value as SocialServerMessage) : null;
  } catch {
    return null;
  }
}

export function createSocialClient(url: string): SocialClient {
  let socket: WebSocket | null = null;
  let active = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(message: SocialServerMessage) => void>();

  function clearTimers(): void {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function open(): void {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      heartbeatTimer = setInterval(() => socket?.send(JSON.stringify({ type: "PING" })), HEARTBEAT_MS);
    });
    socket.addEventListener("message", (event) => {
      const message = parse(event.data);
      if (message) for (const listener of listeners) listener(message);
    });
    socket.addEventListener("close", () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (active) scheduleReconnect();
    });
    socket.addEventListener("error", () => socket?.close());
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (active) open(); }, delay);
  }

  return {
    connect(): void {
      if (active) return;
      active = true;
      reconnectAttempts = 0;
      open();
    },
    disconnect(): void {
      active = false;
      clearTimers();
      socket?.close();
      socket = null;
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
