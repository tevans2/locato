import type { Country } from "../../core/countries";
import { el } from "./createElement";

export interface FlagView {
  readonly element: HTMLElement;
  readonly imageSlot: HTMLElement;
  readonly status: HTMLElement;
}

export function createFlagView(): FlagView {
  const imageSlot = el("div", { className: "flag-slot", attrs: { "aria-live": "polite" } });
  const status = el("span", { className: "round-status", text: "Ready" });
  const element = el("section", {
    className: "flag-card",
    attrs: { "aria-label": "Flag to guess" },
    children: [
      el("div", { className: "flag-card-top", children: [status, el("span", { className: "round-kicker", text: "Mystery flag" })] }),
      imageSlot,
    ],
  });

  return { element, imageSlot, status };
}

export function updateFlagView(view: FlagView, country: Country | null, roundNumber: number): void {
  view.status.textContent = country ? `Round ${roundNumber}` : "Complete";

  if (!country) {
    view.imageSlot.replaceChildren(el("div", { className: "complete-card", text: "World complete" }));
    return;
  }

  const image = el("img", { className: "flag-image", attrs: { src: country.flagSrc, alt: "Flag to guess" } });
  view.imageSlot.replaceChildren(image);
}
