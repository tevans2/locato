import type { GameModeId, PromptGameModeId, WorldMapGameModeId } from "../gameModes";
import type { TimerStorageKeys } from "./playTimer";

const MAP_TIMER_KEYS: Record<WorldMapGameModeId, TimerStorageKeys> = {
  "name-all": {
    last: "locato:country-guessing:timer-last-ms:v1",
    best: "locato:country-guessing:timer-best-ms:v1",
  },
  "click-country": {
    last: "locato:country-guessing:click-country:timer-last-ms:v1",
    best: "locato:country-guessing:click-country:timer-best-ms:v1",
  },
  "spot-country": {
    last: "locato:country-guessing:spot-country:timer-last-ms:v1",
    best: "locato:country-guessing:spot-country:timer-best-ms:v1",
  },
  puzzle: {
    last: "locato:country-guessing:puzzle:timer-last-ms:v1",
    best: "locato:country-guessing:puzzle:timer-best-ms:v1",
  },
};

const PROMPT_TIMER_KEYS: Record<PromptGameModeId, TimerStorageKeys> = {
  flags: {
    last: "locato:solo:flags:timer-last-ms:v1",
    best: "locato:solo:flags:timer-best-ms:v1",
  },
  shapes: {
    last: "locato:solo:shapes:timer-last-ms:v1",
    best: "locato:solo:shapes:timer-best-ms:v1",
  },
  codes: {
    last: "locato:solo:codes:timer-last-ms:v1",
    best: "locato:solo:codes:timer-best-ms:v1",
  },
  capitals: {
    last: "locato:solo:capitals:timer-last-ms:v1",
    best: "locato:solo:capitals:timer-best-ms:v1",
  },
};

export function timerKeysForMode(mode: GameModeId): TimerStorageKeys {
  if (mode in MAP_TIMER_KEYS) {
    return MAP_TIMER_KEYS[mode as WorldMapGameModeId];
  }
  return PROMPT_TIMER_KEYS[mode as PromptGameModeId];
}

export { MAP_TIMER_KEYS, PROMPT_TIMER_KEYS };
