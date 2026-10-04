/*
 * Small, dependency-free multiplayer bits: the name a guest last played under, where a seat's
 * reconnect credentials live, and reading a pasted room code.
 */

import { MAX_PLAYER_NAME_LENGTH, normalizePlayerName } from "./messageValidation";

/** The name a player last used in a room (guests; signed-in players get their account name). */
export const PLAYER_NAME_STORAGE_KEY = "locato.mp.name";

/** Reconnect credentials for the room this tab is seated in (sessionStorage), so a reload keeps the seat. */
export const MULTIPLAYER_SESSION_KEY = "locato.mp.session";

export { MAX_PLAYER_NAME_LENGTH };

export function readPlayerName(storage: Storage | undefined): string | null {
  try {
    const value = normalizePlayerName(storage?.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
    return value || null;
  } catch {
    return null;
  }
}

export function writePlayerName(storage: Storage | undefined, name: string): void {
  const value = normalizePlayerName(name);
  if (!value) return;
  try {
    storage?.setItem(PLAYER_NAME_STORAGE_KEY, value);
  } catch {
    // Storage unavailable (private mode): the name just isn't remembered.
  }
}

/** Room codes are 5 characters from an unambiguous alphabet; accept what people paste (spaces, lowercase, a link). */
export function cleanJoinCode(value: string): string {
  const fromLink = /[?&]room=([^&#\s]+)/i.exec(value)?.[1];
  const raw = fromLink ? decodeURIComponent(fromLink) : value;
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
}
