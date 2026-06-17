import { el } from "./createElement";

export interface FeedbackView {
  readonly element: HTMLElement;
}

export function createFeedbackView(): FeedbackView {
  return { element: el("p", { className: "feedback", attrs: { "aria-live": "polite" }, text: "Choose a mode and start guessing." }) };
}

export function hideFeedback(view: FeedbackView): void {
  view.element.hidden = true;
  view.element.textContent = "";
}

export function showFeedback(view: FeedbackView, message: string, tone: "neutral" | "good" | "bad" = "neutral"): void {
  view.element.hidden = false;
  view.element.className = `feedback ${tone}`;
  view.element.textContent = message;
}
