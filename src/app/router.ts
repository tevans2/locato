import { isFlagPool, type FlagPool } from "../core/flagPools";
import { isPromptGameModeId, isWorldMapGameModeId, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";

export type AppRoute =
  | { readonly type: "landing" }
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean; readonly flagPool?: FlagPool; readonly run?: "timed" }
  | { readonly type: "daily-challenge" }
  | { readonly type: "daily-practice"; readonly date: string }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId; readonly run?: "timed"; readonly continent?: string }
  /** MapTap: `run: "timed"` is a ranked attempt (fixed settings, posts its total to the board). */
  | { readonly type: "map-tap"; readonly run?: "timed" }
  /**
   * Single-run score modes: one way to play, every finished run posts and the board keeps your
   * best. Old `&run=timed` links still open them.
   */
  | { readonly type: "streetview-country" }
  | { readonly type: "geoguessr" }
  | { readonly type: "worldsplit" }
  | { readonly type: "flyover" }
  /**
   * Multiplayer (`?view=multiplayer`). `joinCode` joins that room (`?room=`, the invite link);
   * `create` opens straight into a new room (`&create=1`), optionally inviting one friend by user
   * id once it exists (`&invite=`).
   */
  | { readonly type: "multiplayer"; readonly joinCode?: string; readonly create?: true; readonly invite?: string }
  | { readonly type: "stats" }
  /** Legacy: `?view=flags` now parses to `atlas`. Kept while App still renders the old gallery. */
  | { readonly type: "flag-gallery" }
  /** Learn → Atlas: the index of every country (`?view=atlas`). */
  | { readonly type: "atlas" }
  | { readonly type: "friends"; readonly username?: string }
  /**
   * Leaderboards (`?view=leaderboards[&mode=&variant=]`): every mode's board. The old
   * `?view=leaderboard` and `?view=compete&tab=leaderboards` links land here too.
   */
  | { readonly type: "leaderboards"; readonly mode?: GameModeId; readonly variant?: string }
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
  if (game && isWorldMapGameModeId(game)) {
    // Puzzle boards are per continent, so a timed puzzle link names the continent it's for.
    const continent = params.get("continent")?.trim();
    return { type: "country-guessing", mode: game, ...timed, ...(game === "puzzle" && continent && /^[A-Za-z ]{4,20}$/.test(continent) ? { continent } : {}) };
  }
  if (game === "map-tap") return { type: game, ...timed };
  if (game === "worldsplit" || game === "flyover" || game === "geoguessr" || game === "streetview-country") return { type: game };
  const view = params.get("view");
  if (view === "daily-practice" && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "")) return { type: "daily-practice", date: params.get("date")! };
  if (view === "academy") {
    const lesson = params.get("lesson")?.trim();
    if (lesson === "placement") return { type: "academy-placement" };
    if (lesson && /^[A-Za-z0-9:-]{1,64}$/.test(lesson)) return { type: "academy-lesson", lessonId: lesson };
    const group = params.get("group")?.trim();
    return { type: "academy", ...(group && /^[a-z0-9-]{1,64}$/.test(group) ? { groupId: group } : {}) };
  }
  if (view === "flags" || view === "atlas") return { type: "atlas" };
  if (view === "multiplayer") {
    if (params.get("create") !== "1") return { type: "multiplayer" };
    const invite = params.get("invite")?.trim();
    return { type: "multiplayer", create: true, ...(invite && /^[A-Za-z0-9_-]{1,64}$/.test(invite) ? { invite } : {}) };
  }
  if (view === "daily-challenge" || view === "stats" || view === "friends") return { type: view };
  if (view === "leaderboards" || view === "leaderboard" || view === "compete") {
    const mode = params.get("mode");
    const validMode = mode && (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || ["worldsplit", "flyover", "map-tap", "geoguessr", "streetview-country"].includes(mode));
    // Compete (retired) opened on its Multiplayer tab unless it named a board.
    if (view === "compete" && params.get("tab") !== "leaderboards" && !mode) return { type: "multiplayer" };
    const variant = params.get("variant");
    return { type: "leaderboards", ...(validMode ? { mode: mode as GameModeId } : {}), ...(variant ? { variant } : {}) };
  }
  return null;
}

export function buildRouteUrl(route: AppRoute, location: Pick<Location, "pathname">): string {
  const params = new URLSearchParams();
  if (route.type === "solo-game") {
    params.set("game", route.categoryIds?.find(isPromptGameModeId) ?? "flags");
    if (route.categoryIds && route.categoryIds.length > 1) params.set("categories", route.categoryIds.join(","));
    if (route.flagPool) params.set("flagPool", route.flagPool);
    // Practice runs resume their per-mode save anyway; the flag stays for old links. Timed runs never resume.
    if (route.run !== "timed") params.set("resume", "1");
    if (route.run === "timed") params.set("run", "timed");
  } else if (route.type === "daily-practice") {
    params.set("view", route.type);
    params.set("date", route.date);
  } else if (route.type === "country-guessing") {
    params.set("game", route.mode ?? "name-all");
    if (route.run === "timed") params.set("run", "timed");
    if (route.continent) params.set("continent", route.continent);
  }
  else if (route.type === "map-tap") {
    params.set("game", route.type);
    if (route.run === "timed") params.set("run", "timed");
  }
  else if (route.type === "worldsplit" || route.type === "flyover" || route.type === "geoguessr" || route.type === "streetview-country") params.set("game", route.type);
  else if (route.type === "multiplayer" && route.joinCode) params.set("room", route.joinCode);
  else if (route.type === "multiplayer" && route.create) {
    params.set("view", "multiplayer");
    params.set("create", "1");
    if (route.invite) params.set("invite", route.invite);
  }
  else if (route.type === "friends" && route.username) params.set("friend", route.username);
  else if (route.type === "country-profile") params.set("country", route.code.toLowerCase());
  else if (route.type === "academy" || route.type === "academy-lesson" || route.type === "academy-placement") {
    params.set("view", "academy");
    if (route.type === "academy" && route.groupId) params.set("group", route.groupId);
    if (route.type === "academy-lesson") params.set("lesson", route.lessonId);
    if (route.type === "academy-placement") params.set("lesson", "placement");
  }
  else if (route.type !== "landing") {
    params.set("view", route.type === "flag-gallery" ? "atlas" : route.type);
    if (route.type === "leaderboards") {
      if (route.mode) params.set("mode", route.mode);
      if (route.variant) params.set("variant", route.variant);
    }
  }
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ""}`;
}
