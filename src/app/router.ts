import type { Continent } from "../core/countries";
import type { GameModeId } from "../core/modes";

export type AppRoute =
  | { readonly type: "home" }
  | { readonly type: "mode-select" }
  | { readonly type: "solo-game"; readonly modeId: GameModeId; readonly continent?: Continent; readonly continueSaved?: boolean }
  | { readonly type: "results" }
  | { readonly type: "multiplayer-lobby" };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}
