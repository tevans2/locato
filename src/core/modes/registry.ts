import { classicMode } from "./classic";
import { continentMode } from "./continent";
import { streakMode } from "./streak";
import { timedMode } from "./timed";
import type { GameMode } from "./types";

export const gameModes = {
  classic: classicMode,
  continent: continentMode,
  timed: timedMode,
  streak: streakMode,
} as const;

export type GameModeId = keyof typeof gameModes;

export function getGameMode(modeId: string): GameMode {
  return gameModes[modeId as GameModeId] ?? classicMode;
}

export const selectableModes = Object.values(gameModes);
