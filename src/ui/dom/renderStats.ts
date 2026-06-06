import type { CountryIndex } from "../../core/countries";
import { getGameStats, type GameState } from "../../core/game";
import { el } from "./createElement";

export interface StatsView {
  readonly element: HTMLElement;
  readonly score: HTMLElement;
  readonly streak: HTMLElement;
  readonly accuracy: HTMLElement;
  readonly remaining: HTMLElement;
  readonly timer: HTMLElement;
  readonly timerCard: HTMLElement;
  readonly progress: HTMLElement;
  readonly progressFill: HTMLElement;
}

function statCard(label: string, value: HTMLElement): HTMLElement {
  return el("article", {
    className: "stat-card",
    children: [el("span", { className: "stat-label", text: label }), value],
  });
}

function formatTimer(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function createStatsView(): StatsView {
  const score = el("strong", { className: "stat-value", text: "0" });
  const streak = el("strong", { className: "stat-value", text: "0" });
  const accuracy = el("strong", { className: "stat-value", text: "100%" });
  const remaining = el("strong", { className: "stat-value", text: "196" });
  const timer = el("strong", { className: "stat-value", text: "—" });
  const timerCard = statCard("Time", timer);
  const progress = el("span", { className: "progress-copy", text: "0 guessed" });
  const progressFill = el("div", { className: "progress-fill" });
  const element = el("section", {
    className: "stats-panel",
    attrs: { "aria-label": "Game statistics" },
    children: [
      statCard("Score", score),
      statCard("Streak", streak),
      statCard("Accuracy", accuracy),
      statCard("Remaining", remaining),
      timerCard,
      el("div", { className: "progress-card", children: [progress, el("div", { className: "progress-track", children: [progressFill] })] }),
    ],
  });

  return { element, score, streak, accuracy, remaining, timer, timerCard, progress, progressFill };
}

export function updateStatsView(view: StatsView, index: CountryIndex, state: GameState): void {
  const stats = getGameStats(index, state);
  view.score.textContent = String(state.score);
  view.streak.textContent = String(state.streak);
  view.accuracy.textContent = `${Math.round(stats.accuracy * 100)}%`;
  view.remaining.textContent = String(stats.remainingCount);
  view.timerCard.hidden = state.timeRemainingMs === null;
  view.timer.textContent = state.timeRemainingMs === null ? "—" : formatTimer(state.timeRemainingMs);
  view.progress.textContent = `${stats.guessedCount} guessed, ${stats.remainingCount} hidden`;
  view.progressFill.style.transform = `scaleX(${stats.progress.toFixed(4)})`;
}
