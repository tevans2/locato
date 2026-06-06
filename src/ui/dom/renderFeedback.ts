import { el } from "./createElement";

export interface FeedbackView {
  readonly element: HTMLElement;
}

export function createFeedbackView(): FeedbackView {
  return { element: el("p", { className: "feedback", attrs: { "aria-live": "polite" }, text: "Choose a mode and start guessing." }) };
}

export function showFeedback(view: FeedbackView, message: string, tone: "neutral" | "good" | "bad" = "neutral"): void {
  view.element.className = `feedback ${tone}`;
  view.element.textContent = message;
}
