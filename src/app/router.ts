import type { GameModeId, WorldMapGameModeId } from "../core/gameModes";

export type AppRoute =
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean }
  | { readonly type: "country-guessing"; readonly mode?: WorldMapGameModeId }
  | { readonly type: "multiplayer" }
  | { readonly type: "leaderboard"; readonly mode?: GameModeId; readonly variant?: string };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}
