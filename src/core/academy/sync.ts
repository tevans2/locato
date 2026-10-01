// Client helpers for syncing Academy progress with the signed-in account (GET/PUT /api/academy).
// Session cookies are HttpOnly and same-origin, so fetch sends them automatically. Both helpers
// return null on any failure (guest, offline, rejected payload) and never throw into the UI.

import type { AcademyProgress } from "./types";

// The account copy, or null when there is none yet or the request failed.
export async function fetchAcademyProgress(): Promise<AcademyProgress | null> {
  try {
    const response = await fetch("/api/academy");
    if (!response.ok) return null;
    const data = (await response.json()) as { progress?: AcademyProgress | null };
    return data.progress ?? null;
  } catch {
    return null;
  }
}

// Uploads local progress; the server merges it with the account copy and returns the merged
// result, which the caller should adopt locally.
export async function pushAcademyProgress(progress: AcademyProgress): Promise<AcademyProgress | null> {
  try {
    const response = await fetch("/api/academy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ progress }) });
    if (!response.ok) return null;
    const data = (await response.json()) as { progress?: AcademyProgress | null };
    return data.progress ?? null;
  } catch {
    return null;
  }
}
