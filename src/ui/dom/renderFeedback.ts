import { flashScreen, playCorrect, playWrong } from "./sfx";
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
  // Central cue point for every solo mode: successes chime green, misses buzz red.
  if (tone === "good") {
    playCorrect();
    flashScreen("good");
  } else if (tone === "bad") {
    playWrong();
    flashScreen("bad");
  }
}

/** Adds a small inline action (e.g. "Learn about Chad") after the current feedback message. */
export function appendFeedbackAction(view: FeedbackView, label: string, onClick: () => void): void {
  view.element.append(" ", el("button", { className: "feedback-action", text: label, attrs: { type: "button" }, on: { click: onClick } }));
}
