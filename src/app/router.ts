import { isFlagPool, type FlagPool } from "../core/flagPools";
import { isPromptGameModeId, isWorldMapGameModeId, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";

export type AppRoute =
  | { readonly type: "landing" }
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean; readonly flagPool?: FlagPool; readonly run?: "timed" }
  | { readonly type: "daily-challenge" }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId; readonly run?: "timed" }
  | { readonly type: "streetview-country" }
  | { readonly type: "geoguessr" }
  | { readonly type: "map-tap" }
  | { readonly type: "worldsplit" }
  | { readonly type: "multiplayer"; readonly joinCode?: string }
  | { readonly type: "stats" }
  /** Legacy: `?view=flags` now parses to `atlas`. Kept while App still renders the old gallery. */
  | { readonly type: "flag-gallery" }
  /** Learn → Atlas: the index of every country (`?view=atlas`). */
  | { readonly type: "atlas" }
  | { readonly type: "friends"; readonly username?: string }
  /** Legacy: `?view=leaderboard` now parses to `compete`. Kept while App still renders the old screen. */
  | { readonly type: "leaderboard"; readonly mode?: GameModeId; readonly variant?: string }
  /** Compete: leaderboard modes, boards and timed runs (`?view=compete[&mode=&variant=]`). */
  | { readonly type: "compete"; readonly mode?: GameModeId; readonly variant?: string }
  | { readonly type: "academy"; readonly groupId?: string }
  | { readonly type: "academy-lesson"; readonly lessonId: string }
  | { readonly type: "academy-placement" }
  | { readonly type: "country-profile"; readonly code: string };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}

/** Keep routes in URLs so refresh, sharing and browser navigation preserve the selected game. */
export function routeFromLocation(location: Pick<Location, "search">): AppRoute | null {
  const params = new URLSearchParams(location.search);
  const room = params.get("room")?.trim();
  if (room) return { type: "multiplayer", joinCode: room };
  const country = params.get("country")?.trim();
  if (country && /^[a-z]{2}$/i.test(country)) return { type: "country-profile", code: country.toUpperCase() };
  const friend = params.get("friend")?.trim();
  if (friend) return { type: "friends", username: friend };
  const game = params.get("game");
  const timed = params.get("run") === "timed" ? ({ run: "timed" } as const) : {};
  if (game && isPromptGameModeId(game)) {
    const categories = params.get("categories")?.split(",").filter(isPromptGameModeId);
    const flagPool = params.get("flagPool");
    return {
      type: "solo-game",
      categoryIds: categories?.length ? categories : [game],
      continueSaved: params.get("resume") === "1",
      ...(isFlagPool(flagPool) ? { flagPool } : {}),
      ...timed,
    };
  }
  if (game && isWorldMapGameModeId(game)) return { type: "country-guessing", mode: game, ...timed };
  if (game === "map-tap" || game === "worldsplit" || game === "geoguessr" || game === "streetview-country") return { type: game };
  const view = params.get("view");
  if (view === "academy") {
    const lesson = params.get("lesson")?.trim();
    if (lesson === "placement") return { type: "academy-placement" };
    if (lesson && /^[A-Za-z0-9:-]{1,64}$/.test(lesson)) return { type: "academy-lesson", lessonId: lesson };
    const group = params.get("group")?.trim();
    return { type: "academy", ...(group && /^[a-z0-9-]{1,64}$/.test(group) ? { groupId: group } : {}) };
  }
  if (view === "flags" || view === "atlas") return { type: "atlas" };
  if (view === "daily-challenge" || view === "stats" || view === "friends" || view === "multiplayer") return { type: view };
  if (view === "compete" || view === "leaderboard") {
    const mode = params.get("mode");
    const validMode = mode && (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || ["worldsplit", "map-tap", "geoguessr", "streetview-country"].includes(mode));
    const variant = params.get("variant");
    return { type: "compete", ...(validMode ? { mode: mode as GameModeId } : {}), ...(variant ? { variant } : {}) };
  }
  return null;
}

export function buildRouteUrl(route: AppRoute, location: Pick<Location, "pathname">): string {
  const params = new URLSearchParams();
  if (route.type === "solo-game") {
    params.set("game", route.categoryIds?.find(isPromptGameModeId) ?? "flags");
    if (route.categoryIds && route.categoryIds.length > 1) params.set("categories", route.categoryIds.join(","));
    if (route.flagPool) params.set("flagPool", route.flagPool);
    params.set("resume", "1");
    if (route.run === "timed") params.set("run", "timed");
  } else if (route.type === "country-guessing") {
    params.set("game", route.mode ?? "name-all");
    if (route.run === "timed") params.set("run", "timed");
  }
  else if (["map-tap", "worldsplit", "geoguessr", "streetview-country"].includes(route.type)) params.set("game", route.type);
  else if (route.type === "multiplayer" && route.joinCode) params.set("room", route.joinCode);
  else if (route.type === "friends" && route.username) params.set("friend", route.username);
  else if (route.type === "country-profile") params.set("country", route.code.toLowerCase());
  else if (route.type === "academy" || route.type === "academy-lesson" || route.type === "academy-placement") {
    params.set("view", "academy");
    if (route.type === "academy" && route.groupId) params.set("group", route.groupId);
    if (route.type === "academy-lesson") params.set("lesson", route.lessonId);
    if (route.type === "academy-placement") params.set("lesson", "placement");
  }
  else if (route.type !== "landing") {
    params.set("view", route.type === "flag-gallery" ? "atlas" : route.type === "leaderboard" ? "compete" : route.type);
    if (route.type === "leaderboard" || route.type === "compete") {
      if (route.mode) params.set("mode", route.mode);
      if (route.variant) params.set("variant", route.variant);
    }
  }
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}`;
}
