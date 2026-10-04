import { gameModeOptions, type GameModeOption } from "../../../core/gameModes";
import { DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS, FLYOVER_MULTIPLAYER_DURATIONS_MS } from "../../../core/flyover";
import { MAP_TAP_CATEGORIES, MAP_TAP_CATEGORY_OPTIONS, type MapTapCategory } from "../../../core/maptap";
import type { PublicRoomState, RoomKind } from "../../../core/multiplayer";
import type { ShellIconName } from "../../shell";

/** The prompt modes a quiz room can mix. */
export type QuizMode = "flags" | "flag-colors" | "shapes" | "codes" | "capitals" | "click-country" | "spot-country";

export const QUIZ_MODE_IDS: readonly QuizMode[] = ["flags", "flag-colors", "shapes", "codes", "capitals", "click-country", "spot-country"];

export type QuizModeOption = Omit<GameModeOption, "id"> & { readonly id: QuizMode };

export const QUIZ_MODE_OPTIONS: readonly QuizModeOption[] = gameModeOptions
  .filter((option) => QUIZ_MODE_IDS.includes(option.id as QuizMode))
  .map((option) => ({ ...option, id: option.id as QuizMode }));

export function quizModeLabel(mode: QuizMode): string {
  return QUIZ_MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

/** The server calls "click-country" rounds "pick-country". */
export function quizModeToCategoryId(mode: QuizMode): string {
  return mode === "click-country" ? "pick-country" : mode;
}

export function quizModesFromCategoryIds(categoryIds: readonly string[]): readonly QuizMode[] {
  const modes = categoryIds
    .map((id) => (id === "pick-country" ? "click-country" : id))
    .filter((id): id is QuizMode => QUIZ_MODE_IDS.includes(id as QuizMode));
  return modes.length > 0 ? [...new Set(modes)] : ["flags"];
}

export interface RoomKindInfo {
  readonly kind: RoomKind;
  readonly label: string;
  /** One line on the picker tile. */
  readonly pitch: string;
  readonly icon: ShellIconName;
  /** What to send to create or switch to this kind (a quiz starts on flags). */
  readonly categoryIds: readonly string[];
}

export const ROOM_KIND_INFO: readonly RoomKindInfo[] = [
  { kind: "quiz", label: "Quiz race", pitch: "Flags, capitals, shapes and maps. First right answer takes the round.", icon: "flag", categoryIds: ["flags"] },
  { kind: "map-tap", label: "MapTap", pitch: "Tap the globe where a place is. Closest pin scores most.", icon: "map-pin", categoryIds: ["map-tap"] },
  { kind: "geoguessr", label: "GeoGuessr", pitch: "Drop into the same street. Pin where you think you are.", icon: "binoculars", categoryIds: ["geoguessr"] },
  { kind: "flyover", label: "Flyover", pitch: "Same route, same clock. Fly over the most countries.", icon: "plane", categoryIds: ["flyover"] },
];

export function roomKindInfo(kind: RoomKind): RoomKindInfo {
  return ROOM_KIND_INFO.find((info) => info.kind === kind) ?? ROOM_KIND_INFO[0]!;
}

export interface Choice {
  readonly value: number;
  readonly label: string;
}

const seconds = (values: readonly number[]): readonly Choice[] => values.map((ms) => ({ value: ms, label: `${ms / 1000} sec` }));

/** Rounds on offer per kind (Flyover is one flight). */
export const ROUND_CHOICES: Readonly<Record<Exclude<RoomKind, "flyover">, readonly number[]>> = {
  quiz: [5, 10, 15, 20],
  "map-tap": [5, 10, 15, 20],
  geoguessr: [3, 5, 10],
};

/** Time per round per kind; Flyover's is the flight length. */
export const TIMER_CHOICES: Readonly<Record<RoomKind, readonly Choice[]>> = {
  quiz: seconds([15_000, 30_000, 45_000, 60_000]),
  "map-tap": seconds([30_000, 45_000, 60_000, 90_000]),
  geoguessr: seconds([30_000, 60_000, 90_000, 120_000]),
  flyover: FLYOVER_MULTIPLAYER_DURATIONS_MS.map((ms) => ({ value: ms, label: `${ms / 1000} sec flight` })),
};

export { DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS };

/** Offer the room's current value even if it isn't on the list (an older room, a capped count). */
export function withCurrent(choices: readonly Choice[], value: number, label: (value: number) => string): readonly Choice[] {
  return choices.some((choice) => choice.value === value) ? choices : [...choices, { value, label: label(value) }].sort((a, b) => a.value - b.value);
}

export function mapTapCategoryLabel(categories: readonly MapTapCategory[]): string {
  if (categories.length === MAP_TAP_CATEGORIES.length) return "All places";
  return categories.map((category) => MAP_TAP_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category).join(", ");
}

/** The room's settings as short facts, e.g. ["Flags, Capitals", "Countries only", "10 rounds", "30 sec each"]. */
export function describeRoom(room: Pick<PublicRoomState, "kind" | "categoryIds" | "settings">): readonly string[] {
  const { settings } = room;
  if (room.kind === "flyover") return [`${Math.round(settings.roundDurationMs / 1000)} sec flight`];
  const facts: string[] = [];
  if (room.kind === "quiz") {
    const modes = quizModesFromCategoryIds(room.categoryIds);
    facts.push(modes.map(quizModeLabel).join(", "));
    if (modes.includes("flags") && settings.flagPool && settings.flagPool !== "countries") facts.push("Territories included");
  }
  if (room.kind === "map-tap") facts.push(mapTapCategoryLabel(settings.mapTapCategories ?? MAP_TAP_CATEGORIES));
  facts.push(`${settings.roundLimit} rounds`, `${Math.round(settings.roundDurationMs / 1000)} sec each`);
  return facts;
}
