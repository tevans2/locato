import { DAILY_COUNTRY_COUNT, formatDailyTime } from "../../core/dailyChallenge";
import type { DailyResultSave } from "../../storage/dailySave";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface DailyResultScreenOptions {
  readonly result: DailyResultSave;
  readonly onBackToSolo: () => void;
  readonly onMultiplayer: () => void;
}

export function createDailyResultScreen(options: DailyResultScreenOptions): Screen {
  const { result } = options;
  const copyButton = el("button", { className: "primary-action", text: "Copy share text", attrs: { type: "button" } });
  const backButton = el("button", { className: "ghost-action", text: "Back to modes", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  const share = el("pre", { className: "daily-share-text", text: result.shareText });

  copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(result.shareText);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy share text";
    }, 1400);
  });
  backButton.addEventListener("click", options.onBackToSolo);
  multiplayerButton.addEventListener("click", options.onMultiplayer);

  const element = el("section", {
    className: "game-screen daily-result-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", {
            className: "brand-lockup compact",
            children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
          }),
          el("div", { className: "game-header-actions", children: [multiplayerButton] }),
        ],
      }),
      el("div", {
        className: "daily-result-panel",
        children: [
          el("p", { className: "eyebrow", text: `Daily Challenge ${result.date}` }),
          el("h1", { text: `${result.score}/${DAILY_COUNTRY_COUNT}` }),
          el("div", {
            className: "daily-result-stats",
            children: [
              el("article", { children: [el("span", { text: "Time" }), el("strong", { text: formatDailyTime(result.timeMs) })] }),
              el("article", { children: [el("span", { text: "Hints used" }), el("strong", { text: String(result.hintsUsed) })] }),
            ],
          }),
          share,
          el("div", { className: "daily-legend", children: [el("span", { text: "🟩 correct without hint" }), el("span", { text: "🟨 correct with hint" }), el("span", { text: "🟥 missed or skipped" })] }),
          el("div", { className: "actions", children: [copyButton, backButton] }),
        ],
      }),
    ],
  });

  return {
    element,
    destroy: () => undefined,
  };
}
