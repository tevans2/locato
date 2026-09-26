import { mergeProgress, type AcademyProgress } from "../core/academy";
import { fetchAcademyProgress, pushAcademyProgress } from "../core/academy/sync";
import { readAcademyProgress, saveAcademyProgress } from "../storage/academySave";

/**
 * Single owner of the player's Academy progress for the whole app. Screens read with `get()`
 * and write with `update()`; every change is saved locally at once and, for signed-in players,
 * pushed to the account shortly after (the server merges and returns the combined copy).
 */
export interface AcademyProgressStore {
  readonly get: () => AcademyProgress;
  readonly update: (change: (progress: AcademyProgress) => AcademyProgress) => void;
  readonly subscribe: (listener: (progress: AcademyProgress) => void) => () => void;
  /** Pull the account copy, merge it with local progress and push the result. Call on sign-in. */
  readonly syncWithAccount: () => Promise<void>;
  /** Stop pushing to an account (call on sign-out); local progress is kept. */
  readonly detachAccount: () => void;
}

const PUSH_DELAY_MS = 4_000;

export function createAcademyProgressStore(storage: Storage): AcademyProgressStore {
  let progress = readAcademyProgress(storage);
  let signedIn = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(progress: AcademyProgress) => void>();

  function adopt(next: AcademyProgress): void {
    progress = next;
    saveAcademyProgress(storage, progress);
    for (const listener of listeners) listener(progress);
  }

  async function push(): Promise<void> {
    pushTimer = null;
    if (!signedIn) return;
    const merged = await pushAcademyProgress(progress);
    // Local answers made while the request was in flight must survive adopting the reply.
    if (merged) adopt(mergeProgress(progress, merged));
  }

  function schedulePush(): void {
    if (!signedIn || pushTimer) return;
    pushTimer = setTimeout(() => void push(), PUSH_DELAY_MS);
  }

  if (typeof window !== "undefined") {
    // Don't lose the tail of a lesson when the tab closes before the debounced push fires.
    window.addEventListener("pagehide", () => {
      if (!pushTimer) return;
      clearTimeout(pushTimer);
      void push();
    });
  }

  return {
    get: () => progress,
    update: (change) => {
      adopt(change(progress));
      schedulePush();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncWithAccount: async () => {
      signedIn = true;
      const remote = await fetchAcademyProgress();
      if (remote) adopt(mergeProgress(progress, remote));
      await push();
    },
    detachAccount: () => {
      signedIn = false;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
    },
  };
}
