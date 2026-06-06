import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface HomeScreenOptions {
  readonly hasSave: boolean;
  readonly onContinue: () => void;
  readonly onSolo: () => void;
  readonly onMultiplayer: () => void;
}

export function createHomeScreen(options: HomeScreenOptions): Screen {
  const logo = el("div", {
    className: "brand-lockup",
    children: [
      el("span", { className: "map-pin-logo", attrs: { "aria-hidden": "true" } }),
      el("span", { className: "brand-name", text: "locale" }),
    ],
  });

  const continueButton = el("button", { className: "primary-action", text: "Continue run", on: { click: options.onContinue } });
  continueButton.toggleAttribute("disabled", !options.hasSave);

  const element = el("section", {
    className: "home-screen",
    children: [
      el("div", {
        className: "hero-copy",
        children: [
          logo,
          el("p", { className: "eyebrow", text: "World flags, exact instincts" }),
          el("h1", { text: "Know the place by its mark." }),
          el("p", {
            className: "lede",
            text: "A minimal geography game about reading flags fast, tracking territory, and clearing the world one locale at a time.",
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
