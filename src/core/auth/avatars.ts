// Shared emoji avatar helpers — used by the auth panel picker and multiplayer player displays.

export const AVATAR_OPTIONS = [
  "🌍", "🌎", "🌏", "🗺️", "🧭",
  "🏔️", "🏝️", "🌋", "🗼", "🗽",
  "🦁", "🐘", "🦊", "🐨", "🦅",
  "🦜", "🐬", "🦋", "🌺", "🌵",
] as const;

// Single device-level key. No per-account prefix: the chosen emoji is a device preference so it
// is readable by the multiplayer screens without an auth user ID, and persists for guests too.
const STORAGE_KEY = "locato.avatar";

export function getStoredAvatar(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function storeAvatar(emoji: string): void {
  try { localStorage.setItem(STORAGE_KEY, emoji); } catch { /* storage unavailable */ }
}

// Returns the stored emoji for the local player, or a stable deterministic one for others.
// `isLocal` is true for the player whose entry belongs to this device.
export function getPlayerEmoji(playerId: string, isLocal: boolean): string {
  if (isLocal) {
    const stored = getStoredAvatar();
    if (stored) return stored;
  }
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  return AVATAR_OPTIONS[hash % AVATAR_OPTIONS.length] ?? "🌍";
}
