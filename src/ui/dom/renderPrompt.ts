import type { PromptContent } from "../../core/categories";
import { el } from "./createElement";

export interface PromptView {
  readonly element: HTMLElement;
  readonly imageSlot: HTMLElement;
  readonly status: HTMLElement;
  readonly kicker: HTMLElement;
}


export function promptImageClass(src: string): string {
  return src.includes("/country-shapes/") ? "flag-image country-shape-image" : "flag-image";
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
    view.imageSlot.replaceChildren(el("img", { className: promptImageClass(content.value), attrs: { src: content.value, alt: "Prompt to guess" } }));
    return;
  }

  view.imageSlot.replaceChildren(el("div", { className: "prompt-text", text: content.value }));
}
