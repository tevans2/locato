import {
  isMapTapGameModeId,
  isPromptGameModeId,
  isStreetViewGameModeId,
  isWorldMapGameModeId,
  type GameModeId,
  type WorldMapGameModeId,
} from "../core/gameModes";

export type AppRoute =
  | { readonly type: "landing" }
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean }
  | { readonly type: "daily-challenge" }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId }
  | { readonly type: "streetview-country" }
  | { readonly type: "map-tap" }
  | { readonly type: "multiplayer"; readonly joinCode?: string }
  | { readonly type: "stats" }
  | { readonly type: "progress" }
  | { readonly type: "friends"; readonly username?: string }
  | { readonly type: "leaderboard"; readonly mode?: GameModeId; readonly variant?: string };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function routeFromLocation(location: Pick<Location, "pathname" | "search">): AppRoute {
  const params = new URLSearchParams(location.search);
  const room = params.get("room")?.trim();
  const friend = params.get("friend")?.trim();
  const path = location.pathname.replace(/\/+$/, "") || "/";

  // Preserve the original query-string invite URLs while also supporting the
  // new readable paths.
  if (room) return { type: "multiplayer", joinCode: room };
  if (friend) return { type: "friends", username: friend };
  if (path === "/") return { type: "landing" };
  if (path === "/daily") return { type: "daily-challenge" };
  if (path === "/multiplayer") return { type: "multiplayer" };
  if (path === "/stats") return { type: "stats" };
  if (path === "/progress") return { type: "progress" };
  if (path === "/friends") return { type: "friends" };
  if (path === "/play") return { type: "solo-game", continueSaved: true };

  const playMode = safeDecode(path.match(/^\/play\/([^/]+)$/)?.[1] ?? "");
  if (isPromptGameModeId(playMode)) return { type: "solo-game", categoryIds: [playMode] };
  if (isWorldMapGameModeId(playMode)) return { type: "country-guessing", mode: playMode };
  if (isStreetViewGameModeId(playMode)) return { type: "streetview-country" };
  if (isMapTapGameModeId(playMode)) return { type: "map-tap" };

  const leaderboardMode = safeDecode(path.match(/^\/leaderboards\/([^/]+)$/)?.[1] ?? "");
  if (path === "/leaderboards") return { type: "leaderboard" };
  if (
    isPromptGameModeId(leaderboardMode) ||
    isWorldMapGameModeId(leaderboardMode) ||
    isStreetViewGameModeId(leaderboardMode) ||
    isMapTapGameModeId(leaderboardMode)
  ) {
    const variant = params.get("variant")?.trim();
    return { type: "leaderboard", mode: leaderboardMode, ...(variant ? { variant } : {}) };
  }

  return { type: "landing" };
}

export function routeUrl(route: AppRoute): string {
  switch (route.type) {
    case "landing": return "/";
    case "daily-challenge": return "/daily";
    case "multiplayer": return `/multiplayer${route.joinCode ? `?room=${encodeURIComponent(route.joinCode)}` : ""}`;
    case "stats": return "/stats";
    case "progress": return "/progress";
    case "friends": return `/friends${route.username ? `?friend=${encodeURIComponent(route.username)}` : ""}`;
    case "leaderboard": {
      const path = route.mode ? `/leaderboards/${encodeURIComponent(route.mode)}` : "/leaderboards";
      return `${path}${route.variant ? `?variant=${encodeURIComponent(route.variant)}` : ""}`;
    }
    case "country-guessing": return `/play/${route.mode ?? "name-all"}`;
    case "streetview-country": return "/play/streetview-country";
    case "map-tap": return "/play/map-tap";
    case "solo-game": {
      const mode = route.categoryIds?.length === 1 ? route.categoryIds[0] : null;
      return mode && isPromptGameModeId(mode) ? `/play/${mode}` : "/play";
    }
  }
}
