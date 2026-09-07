import { isPromptGameModeId, isWorldMapGameModeId, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";

export type AppRoute =
  | { readonly type: "landing" }
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean }
  | { readonly type: "daily-challenge" }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId }
  | { readonly type: "streetview-country" }
  | { readonly type: "geoguessr" }
  | { readonly type: "map-tap" }
  | { readonly type: "worldsplit" }
  | { readonly type: "multiplayer"; readonly joinCode?: string }
  | { readonly type: "stats" }
  | { readonly type: "friends"; readonly username?: string }
  | { readonly type: "leaderboard"; readonly mode?: GameModeId; readonly variant?: string };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}

/** Keep routes in URLs so refresh, sharing and browser navigation preserve the selected game. */
export function routeFromLocation(location: Pick<Location, "search">): AppRoute | null {
  const params = new URLSearchParams(location.search);
  const room = params.get("room")?.trim();
  if (room) return { type: "multiplayer", joinCode: room };
  const friend = params.get("friend")?.trim();
  if (friend) return { type: "friends", username: friend };
  const game = params.get("game");
  if (game && isPromptGameModeId(game)) {
    const categories = params.get("categories")?.split(",").filter(isPromptGameModeId);
    return { type: "solo-game", categoryIds: categories?.length ? categories : [game], continueSaved: params.get("resume") === "1" };
  }
  if (game && isWorldMapGameModeId(game)) return { type: "country-guessing", mode: game };
  if (game === "map-tap" || game === "worldsplit" || game === "geoguessr" || game === "streetview-country") return { type: game };
  const view = params.get("view");
  if (view === "daily-challenge" || view === "stats" || view === "friends" || view === "multiplayer") return { type: view };
  if (view === "leaderboard") {
    const mode = params.get("mode");
    const validMode = mode && (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || ["worldsplit", "map-tap", "geoguessr", "streetview-country"].includes(mode));
    const variant = params.get("variant");
    return { type: "leaderboard", ...(validMode ? { mode: mode as GameModeId } : {}), ...(variant ? { variant } : {}) };
  }
  return null;
}

export function buildRouteUrl(route: AppRoute, location: Pick<Location, "pathname">): string {
  const params = new URLSearchParams();
  if (route.type === "solo-game") {
    params.set("game", route.categoryIds?.find(isPromptGameModeId) ?? "flags");
    if (route.categoryIds && route.categoryIds.length > 1) params.set("categories", route.categoryIds.join(","));
    params.set("resume", "1");
  } else if (route.type === "country-guessing") params.set("game", route.mode ?? "name-all");
  else if (["map-tap", "worldsplit", "geoguessr", "streetview-country"].includes(route.type)) params.set("game", route.type);
  else if (route.type === "multiplayer" && route.joinCode) params.set("room", route.joinCode);
  else if (route.type === "friends" && route.username) params.set("friend", route.username);
  else if (route.type !== "landing") {
    params.set("view", route.type);
    if (route.type === "leaderboard") {
      if (route.mode) params.set("mode", route.mode);
      if (route.variant) params.set("variant", route.variant);
    }
  }
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}`;
}
