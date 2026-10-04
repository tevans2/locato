import { soloPromptCategories } from "./categories";
import { LEADERBOARD_MODES } from "./leaderboards";

export type PromptGameModeId = "flags" | "flag-colors" | "shapes" | "codes" | "capitals" | "capital-recall";
export type WorldMapGameModeId = "name-all" | "click-country" | "spot-country" | "puzzle";
export type StreetViewGameModeId = "streetview-country" | "geoguessr";
export type MapTapGameModeId = "map-tap";
export type WorldSplitGameModeId = "worldsplit";
export type FlyoverGameModeId = "flyover";
export type TimerGameModeId = PromptGameModeId | WorldMapGameModeId;
export type GameModeId = TimerGameModeId | StreetViewGameModeId | MapTapGameModeId | WorldSplitGameModeId | FlyoverGameModeId;

export interface GameModeOption {
  readonly id: GameModeId;
  readonly label: string;
  readonly description: string;
  readonly group: "Prompt games" | "World map games" | "Street View games";
}

const PROMPT_GAME_MODE_IDS: readonly PromptGameModeId[] = ["flags", "flag-colors", "shapes", "codes", "capitals", "capital-recall"];
const WORLD_MAP_GAME_MODE_IDS: readonly WorldMapGameModeId[] = ["name-all", "click-country", "spot-country", "puzzle"];
const STREET_VIEW_GAME_MODE_IDS: readonly StreetViewGameModeId[] = ["streetview-country", "geoguessr"];
const MAP_TAP_GAME_MODE_IDS: readonly MapTapGameModeId[] = ["map-tap"];
const WORLD_SPLIT_GAME_MODE_IDS: readonly WorldSplitGameModeId[] = ["worldsplit"];
const FLYOVER_GAME_MODE_IDS: readonly FlyoverGameModeId[] = ["flyover"];

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

export const worldSplitGameModeOptions: readonly GameModeOption[] = [
  {
    id: "worldsplit",
    label: "Worldsplit",
    description: "Draw one straight line that divides a population as evenly as possible.",
    group: "World map games",
  },
];

export const streetViewGameModeOptions: readonly GameModeOption[] = [
  {
    id: "geoguessr",
    label: "GeoGuessr",
    description: "Explore a mystery Street View, pin the exact location, and score up to 5,000 points per round.",
    group: "Street View games",
  },
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

export const flyoverGameModeOptions: readonly GameModeOption[] = [
  {
    id: "flyover",
    label: "Flyover",
    description: "Steer a plane over the named country, then the next — as many as you can before the clock runs out.",
    group: "World map games",
  },
];

export const timerGameModeOptions: readonly GameModeOption[] = [...promptGameModeOptions, ...worldMapGameModeOptions];
export const gameModeOptions: readonly GameModeOption[] = [...timerGameModeOptions, ...worldSplitGameModeOptions, ...flyoverGameModeOptions, ...mapTapGameModeOptions, ...streetViewGameModeOptions];

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

export function isWorldSplitGameModeId(id: string): id is WorldSplitGameModeId {
  return WORLD_SPLIT_GAME_MODE_IDS.includes(id as WorldSplitGameModeId);
}

export function isFlyoverGameModeId(id: string): id is FlyoverGameModeId {
  return FLYOVER_GAME_MODE_IDS.includes(id as FlyoverGameModeId);
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

// ---------------------------------------------------------------------------------------------
// Catalogue used by the navigation shell (landing, game switcher, Leaderboards). docs/navigation.md
// fixes the grouping: the same three groups, in the same order, everywhere.

export type GameModeGroupId = "clues" | "map" | "street-view";

/** Lucide icon names; the shell's icon set (src/ui/shell/icons.ts) draws every one of them. */
export type GameModeIcon =
  | "flag" | "palette" | "shapes" | "hash" | "crown" | "map-pin" | "globe" | "mouse-pointer-click"
  | "eye" | "puzzle" | "orbit" | "split" | "binoculars" | "plane";

export interface GameModeCatalogueEntry {
  readonly id: GameModeId;
  /** Sentence-case name shown in the switcher, picker and Leaderboards. */
  readonly label: string;
  /** One short line (under ~50 characters). */
  readonly blurb: string;
  readonly icon: GameModeIcon;
  /** Has a leaderboard (every mode does; see src/core/leaderboards.ts for how it ranks). */
  readonly leaderboard: boolean;
}

export interface GameModeGroup {
  readonly id: GameModeGroupId;
  readonly label: "Clues" | "Map" | "Street View";
  readonly tagline: string;
  readonly modes: readonly GameModeCatalogueEntry[];
}

/** Every mode with a board, from src/core/leaderboards.ts (the server validates against the same table). */
export const LEADERBOARD_GAME_MODE_IDS: readonly GameModeId[] = LEADERBOARD_MODES.map((config) => config.mode);
export type LeaderboardGameModeId = GameModeId;

export function isLeaderboardMode(id: string): id is LeaderboardGameModeId {
  return (LEADERBOARD_GAME_MODE_IDS as readonly string[]).includes(id);
}

const entry = (id: GameModeId, label: string, blurb: string, icon: GameModeIcon): GameModeCatalogueEntry => ({ id, label, blurb, icon, leaderboard: isLeaderboardMode(id) });

export const GAME_MODE_GROUPS: readonly GameModeGroup[] = [
  {
    id: "clues",
    label: "Clues",
    tagline: "One clue on screen — name the country it belongs to.",
    modes: [
      entry("flags", "Flags", "Name the country from its flag.", "flag"),
      entry("flag-colors", "Flag colours", "Reveal the hidden flag, colour by colour.", "palette"),
      entry("shapes", "Country outlines", "Name a country from its outline alone.", "shapes"),
      entry("codes", "Country codes", "Decode the country behind its ISO code.", "hash"),
      entry("capitals", "Capitals", "See a capital and name its country.", "crown"),
      entry("capital-recall", "Capital recall", "See a country and name its capital.", "map-pin"),
    ],
  },
  {
    id: "map",
    label: "Map",
    tagline: "Point, click and drag your way around the world.",
    modes: [
      entry("name-all", "Name all countries", "Type every country you know.", "globe"),
      entry("click-country", "Click the country", "Find the named country on the map.", "mouse-pointer-click"),
      entry("spot-country", "Spot the country", "Name the country that lights up.", "eye"),
      entry("puzzle", "Puzzle", "Rebuild a continent by hand.", "puzzle"),
      entry("map-tap", "MapTap", "Pin cities and landmarks on the globe.", "orbit"),
      entry("worldsplit", "Worldsplit", "Draw one line to split a population.", "split"),
      entry("flyover", "Flyover", "Steer a plane over the named country.", "plane"),
    ],
  },
  {
    id: "street-view",
    label: "Street View",
    tagline: "Dropped on a random street somewhere on earth.",
    modes: [
      entry("geoguessr", "GeoGuessr", "Explore the street, then pin the spot.", "map-pin"),
      entry("streetview-country", "Street View country", "Look around and name the country.", "binoculars"),
    ],
  },
];

export function gameModeCatalogueEntry(id: GameModeId): GameModeCatalogueEntry {
  for (const group of GAME_MODE_GROUPS) {
    const found = group.modes.find((mode) => mode.id === id);
    if (found) return found;
  }
  return GAME_MODE_GROUPS[0]!.modes[0]!;
}

export function gameModeGroupOf(id: GameModeId): GameModeGroup {
  return GAME_MODE_GROUPS.find((group) => group.modes.some((mode) => mode.id === id)) ?? GAME_MODE_GROUPS[0]!;
}
