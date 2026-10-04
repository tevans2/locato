// Shared emoji avatar helpers — used by the auth panel picker and multiplayer player displays.

export const AVATAR_OPTIONS = [
  "🌍", "🌎", "🌏", "🗺️", "🧭",
  "🏔️", "🏝️", "🌋", "🗼", "🗽",
  "🦁", "🐘", "🦊", "🐨", "🦅",
  "🦜", "🐬", "🦋", "🌺", "🌵",
] as const;

export type AvatarEmoji = (typeof AVATAR_OPTIONS)[number];

export function isAvatarEmoji(value: unknown): value is AvatarEmoji {
  return typeof value === "string" && (AVATAR_OPTIONS as readonly string[]).includes(value);
}

// Single device-level key. No per-account prefix: the chosen emoji is a device preference so it
// is readable by the multiplayer screens without an auth user ID, and persists for guests too.
const STORAGE_KEY = "locato.avatar";
// Fallback for devices that never picked one (guests). Kept separate from STORAGE_KEY so it is
// never mistaken for a deliberate pick and synced to an account.
const DEVICE_FALLBACK_KEY = "locato.avatar.device";

export function getStoredAvatar(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isAvatarEmoji(stored) ? stored : null;
  } catch { return null; }
}

export function storeAvatar(emoji: string): void {
  try { localStorage.setItem(STORAGE_KEY, emoji); } catch { /* storage unavailable */ }
}

// On sign-out, so the next account to sign in on this device doesn't inherit the pick.
export function clearStoredAvatar(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

// The emoji this device shows itself as in multiplayer: the user's pick, otherwise a random one
// chosen once and remembered so it doesn't change between rooms.
export function getLocalAvatar(): AvatarEmoji {
  const stored = getStoredAvatar();
  if (isAvatarEmoji(stored)) return stored;
  try {
    const fallback = localStorage.getItem(DEVICE_FALLBACK_KEY);
    if (isAvatarEmoji(fallback)) return fallback;
    const picked = AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)] ?? "🌍";
    localStorage.setItem(DEVICE_FALLBACK_KEY, picked);
    return picked;
  } catch {
    return "🌍";
  }
}

// The emoji to render for a multiplayer player. The server relays each player's own avatar, so
// every client shows the same one; the id hash only covers clients too old to send one.
export function getPlayerEmoji(player: { readonly id: string; readonly avatarEmoji?: string }, isLocal: boolean): string {
  if (isAvatarEmoji(player.avatarEmoji)) return player.avatarEmoji;
  if (isLocal) return getLocalAvatar();
  let hash = 0;
  for (let i = 0; i < player.id.length; i++) hash = (hash * 31 + player.id.charCodeAt(i)) >>> 0;
  return AVATAR_OPTIONS[hash % AVATAR_OPTIONS.length] ?? "🌍";
}
