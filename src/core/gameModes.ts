import { soloPromptCategories } from "./categories";

export type PromptGameModeId = "flags" | "flag-colors" | "shapes" | "codes" | "capitals";
export type WorldMapGameModeId = "name-all" | "click-country" | "spot-country" | "puzzle";
export type StreetViewGameModeId = "streetview-country";
export type MapTapGameModeId = "map-tap";
export type TimerGameModeId = PromptGameModeId | WorldMapGameModeId;
export type GameModeId = TimerGameModeId | StreetViewGameModeId | MapTapGameModeId;

export interface GameModeOption {
  readonly id: GameModeId;
  readonly label: string;
  readonly description: string;
  readonly group: "Prompt games" | "World map games" | "Street View games";
}

const PROMPT_GAME_MODE_IDS: readonly PromptGameModeId[] = ["flags", "flag-colors", "shapes", "codes", "capitals"];
const WORLD_MAP_GAME_MODE_IDS: readonly WorldMapGameModeId[] = ["name-all", "click-country", "spot-country", "puzzle"];
const STREET_VIEW_GAME_MODE_IDS: readonly StreetViewGameModeId[] = ["streetview-country"];
const MAP_TAP_GAME_MODE_IDS: readonly MapTapGameModeId[] = ["map-tap"];

export const promptGameModeOptions: readonly GameModeOption[] = PROMPT_GAME_MODE_IDS.map((id) => {
  const category = soloPromptCategories.find((item) => item.id === id);
  return {
    id,
    label: category?.label ?? id,
    description: category?.description ?? "Play a prompt-based country guessing round.",
    group: "Prompt games" as const,
  };
});

export const worldMapGameModeOptions: readonly GameModeOption[] = [
  {
    id: "name-all",
    label: "Name all countries",
    description: "Type as many country names as you can and reveal the whole world map.",
    group: "World map games",
  },
  {
    id: "click-country",
    label: "Click on the country",
    description: "A random country name appears; click the matching country on the map.",
    group: "World map games",
  },
  {
    id: "spot-country",
    label: "Spot the country",
    description: "A country flashes on the map — type its name before moving on.",
    group: "World map games",
  },
  {
    id: "puzzle",
    label: "Puzzle",
    description: "Choose a continent, place every country by hand, then check your accuracy.",
    group: "World map games",
  },
];

export const streetViewGameModeOptions: readonly GameModeOption[] = [
  {
    id: "streetview-country",
    label: "Street View Country",
    description: "Interactive Street View challenge: guess the hidden country from up to 3 moveable frames.",
    group: "Street View games",
  },
];

export const mapTapGameModeOptions: readonly GameModeOption[] = [
  {
    id: "map-tap",
    label: "MapTap",
    description: "Rotate a satellite globe and click the named city, landmark, mountain, or point of interest.",
    group: "World map games",
  },
];

export const timerGameModeOptions: readonly GameModeOption[] = [...promptGameModeOptions, ...worldMapGameModeOptions];
export const gameModeOptions: readonly GameModeOption[] = [...timerGameModeOptions, ...mapTapGameModeOptions, ...streetViewGameModeOptions];

export function isPromptGameModeId(id: string): id is PromptGameModeId {
  return PROMPT_GAME_MODE_IDS.includes(id as PromptGameModeId);
}

export function isWorldMapGameModeId(id: string): id is WorldMapGameModeId {
  return WORLD_MAP_GAME_MODE_IDS.includes(id as WorldMapGameModeId);
}

export function isStreetViewGameModeId(id: string): id is StreetViewGameModeId {
  return STREET_VIEW_GAME_MODE_IDS.includes(id as StreetViewGameModeId);
}

export function isMapTapGameModeId(id: string): id is MapTapGameModeId {
  return MAP_TAP_GAME_MODE_IDS.includes(id as MapTapGameModeId);
}

export function isTimerGameModeId(id: string): id is TimerGameModeId {
  return isPromptGameModeId(id) || isWorldMapGameModeId(id);
}

export function getGameModeOption(id: GameModeId): GameModeOption {
  return gameModeOptions.find((option) => option.id === id) ?? gameModeOptions[0]!;
}

export function promptGameModeFromCategoryIds(categoryIds: readonly string[]): PromptGameModeId {
  const selected = categoryIds.find(isPromptGameModeId);
  return selected ?? "flags";
}
