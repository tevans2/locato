import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface HomeScreenOptions {
  readonly hasSave: boolean;
  readonly onContinue: () => void;
  readonly onSolo: () => void;
  readonly onMultiplayer: () => void;
}

export function createHomeScreen(options: HomeScreenOptions): Screen {
  const continueButton = el("button", { className: "primary-action", text: "Continue run", on: { click: options.onContinue } });
  continueButton.toggleAttribute("disabled", !options.hasSave);

  const element = el("section", {
    className: "home-screen",
    children: [
      el("div", {
        className: "hero-copy",
        children: [
          el("p", { className: "eyebrow", text: "GeoQuest Arcade" }),
          el("h1", { text: "Flag Rush" }),
          el("p", {
            className: "lede",
            text: "A rebuilt flag challenge designed for fast solo play today and server-authoritative multiplayer tomorrow.",
          }),
        ],
      }),
      el("div", {
        className: "home-actions",
        children: [
          continueButton,
          el("button", { className: "primary-action", text: "New solo game", on: { click: options.onSolo } }),
          el("button", { className: "secondary-action", text: "Multiplayer preview", on: { click: options.onMultiplayer } }),
        ],
      }),
    ],
  });

  return { element, destroy: () => undefined };
}
