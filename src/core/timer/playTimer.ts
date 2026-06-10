export type PlayTimerMode = "off" | "count-up";

export interface TimerStorageKeys {
  readonly last: string;
  readonly best: string;
}

export function readStoredTime(storage: Storage, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredTime(storage: Storage, key: string, elapsedMs: number): void {
  try {
    storage.setItem(key, String(Math.max(1, Math.round(elapsedMs))));
  } catch {
    // Ignore storage failures so the game still works in private or locked-down browsers.
  }
}

export function formatElapsedTime(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs));
  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  const tenths = Math.floor((safeElapsedMs % 1000) / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function formatStoredTime(elapsedMs: number | null): string {
  return elapsedMs === null ? "—" : formatElapsedTime(elapsedMs);
}

export interface PlayTimer {
  readonly mode: PlayTimerMode;
  setMode(mode: PlayTimerMode): void;
  reloadStoredTimes(): void;
  startIfNeeded(): void;
  stop(): number;
  reset(): void;
  currentElapsedMs(): number;
  readLast(): number | null;
  readBest(): number | null;
  writeCompletion(finalTimeMs: number): boolean;
  destroy(): void;
}

export interface CreatePlayTimerOptions {
  readonly storage: Storage;
  readonly keys: TimerStorageKeys;
  readonly onTick: () => void;
  readonly isComplete?: () => boolean;
}

export function createPlayTimer(options: CreatePlayTimerOptions): PlayTimer {
  let mode: PlayTimerMode = "off";
  let startedAt: number | null = null;
  let elapsedMs = 0;
  let intervalId: number | null = null;
  let lastMs = readStoredTime(options.storage, options.keys.last);
  let bestMs = readStoredTime(options.storage, options.keys.best);

  function clearIntervalId(): void {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function currentElapsedMs(): number {
    return startedAt === null ? elapsedMs : Date.now() - startedAt;
  }

  function render(): void {
    options.onTick();
  }

  return {
    get mode() {
      return mode;
    },
    setMode(nextMode: PlayTimerMode): void {
      mode = nextMode;
    },
    reloadStoredTimes(): void {
      lastMs = readStoredTime(options.storage, options.keys.last);
      bestMs = readStoredTime(options.storage, options.keys.best);
    },
    startIfNeeded(): void {
      if (mode !== "count-up" || startedAt !== null || options.isComplete?.()) return;
      startedAt = Date.now() - elapsedMs;
      intervalId = window.setInterval(render, 100);
      render();
    },
    stop(): number {
      elapsedMs = currentElapsedMs();
      startedAt = null;
      clearIntervalId();
      render();
      return elapsedMs;
    },
    reset(): void {
      startedAt = null;
      elapsedMs = 0;
      clearIntervalId();
      render();
    },
    currentElapsedMs,
    readLast: () => lastMs,
    readBest: () => bestMs,
    writeCompletion(finalTimeMs: number): boolean {
      lastMs = finalTimeMs;
      writeStoredTime(options.storage, options.keys.last, finalTimeMs);
      const isNewBest = bestMs === null || finalTimeMs < bestMs;
      if (isNewBest) {
        bestMs = finalTimeMs;
        writeStoredTime(options.storage, options.keys.best, finalTimeMs);
      }
      render();
      return isNewBest;
    },
    destroy(): void {
      clearIntervalId();
    },
  };
}
