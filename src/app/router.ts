export type AppRoute =
  | { readonly type: "solo-game"; readonly categoryIds?: readonly string[]; readonly continueSaved?: boolean }
  | { readonly type: "country-guessing" }
  | { readonly type: "multiplayer" }
  | { readonly type: "stats" };

export interface Screen {
  readonly element: HTMLElement;
  readonly destroy: () => void;
}
