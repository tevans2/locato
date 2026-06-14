import type { PromptContent } from "../../core/categories";
import { el } from "./createElement";

export interface PromptView {
  readonly element: HTMLElement;
  readonly imageSlot: HTMLElement;
  readonly status: HTMLElement;
  readonly kicker: HTMLElement;
}


function isCountryShapePrompt(src: string): boolean {
  return src.includes("country-shapes/");
}

function setBackgroundImage(element: HTMLElement, src: string): void {
  element.style.backgroundImage = `url("${src.replace(/["\\]/g, "\\$&")}")`;
}

export function promptImageClass(src: string): string {
  return isCountryShapePrompt(src) ? "flag-image country-shape-image" : "flag-image";
}

export function createPromptView(): PromptView {
  const imageSlot = el("div", { className: "flag-slot", attrs: { "aria-live": "polite" } });
  const status = el("span", { className: "round-status", text: "Ready" });
  const kicker = el("span", { className: "round-kicker", text: "Mystery prompt" });
  const element = el("section", {
    className: "flag-card",
    attrs: { "aria-label": "Prompt to guess" },
    children: [el("div", { className: "flag-card-top", children: [status, kicker] }), imageSlot],
  });

  return { element, imageSlot, status, kicker };
}

export function updatePromptView(view: PromptView, content: PromptContent | null, roundNumber: number, kicker: string): void {
  view.status.textContent = content ? `Round ${roundNumber}` : "Complete";
  view.kicker.textContent = kicker;

  if (!content) {
    view.imageSlot.replaceChildren(el("div", { className: "complete-card", text: "All prompts cleared" }));
    return;
  }

  if (content.kind === "image") {
    if (isCountryShapePrompt(content.value)) {
      const shapePrompt = el("div", { className: "country-shape-prompt", attrs: { role: "img", "aria-label": "Country outline prompt" } });
      setBackgroundImage(shapePrompt, content.value);
      view.imageSlot.replaceChildren(shapePrompt);
      return;
    }

    view.imageSlot.replaceChildren(el("img", { className: promptImageClass(content.value), attrs: { src: content.value, alt: "Prompt to guess" } }));
    return;
  }

  if (content.kind === "map-click" || content.kind === "map-highlight" || content.kind === "flag-colors") {
    view.imageSlot.replaceChildren(el("div", { className: "prompt-text", text: content.value }));
    return;
  }

  view.imageSlot.replaceChildren(el("div", { className: "prompt-text", text: content.value }));
}
