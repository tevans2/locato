import type { GameModeId, WorldMapGameModeId } from "../core/gameModes";

export type AppRoute =
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean }
  | { readonly type: "daily-challenge" }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId }
  | { readonly type: "streetview-country" }
  | { readonly type: "map-tap" }
  | { readonly type: "multiplayer"; readonly joinCode?: string }
  | { readonly type: "stats" }
  | { readonly type: "friends"; readonly username?: string }
  | { readonly type: "leaderboard"; readonly mode?: GameModeId; readonly variant?: string };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}
