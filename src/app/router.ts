import type { Continent } from "../core/countries";
import type { GameModeId } from "../core/modes";

export type AppRoute = { readonly type: "solo-game"; readonly modeId: GameModeId; readonly continent?: Continent; readonly continueSaved?: boolean };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}
