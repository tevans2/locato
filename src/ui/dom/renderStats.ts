import type { CountryIndex } from "../../core/countries";
import { getGameStats, type GameState } from "../../core/game";
import { el } from "./createElement";

export interface StatsView {
  readonly element: HTMLElement;
  readonly scoreLabel: HTMLElement;
  readonly score: HTMLElement;
  readonly streak: HTMLElement;
  readonly accuracy: HTMLElement;
  readonly remaining: HTMLElement;
  readonly progress: HTMLElement;
  readonly progressFill: HTMLElement;
}

function statCard(label: string, value: HTMLElement): { card: HTMLElement; labelEl: HTMLElement } {
  const labelEl = el("span", { className: "stat-label", text: label });
  return { card: el("article", { className: "stat-card", children: [labelEl, value] }), labelEl };
}

export function createStatsView(): StatsView {
  const score = el("strong", { className: "stat-value", text: "0" });
  const streak = el("strong", { className: "stat-value", text: "0" });
  const accuracy = el("strong", { className: "stat-value", text: "100%" });
  const remaining = el("strong", { className: "stat-value", text: "196" });
  const progress = el("span", { className: "progress-copy", text: "0 guessed" });
  const progressFill = el("div", { className: "progress-fill" });
  const scoreCard = statCard("Score", score);
  const streakCard = statCard("Streak", streak);
  const accuracyCard = statCard("Accuracy", accuracy);
  const remainingCard = statCard("Remaining", remaining);
  const element = el("section", {
    className: "stats-panel",
    attrs: { "aria-label": "Game statistics" },
    children: [
      scoreCard.card,
      streakCard.card,
      accuracyCard.card,
      remainingCard.card,
      el("div", { className: "progress-card", children: [progress, el("div", { className: "progress-track", children: [progressFill] })] }),
    ],
  });

  return { element, scoreLabel: scoreCard.labelEl, score, streak, accuracy, remaining, progress, progressFill };
}

export function updateStatsView(view: StatsView, index: CountryIndex, state: GameState): void {
  const stats = getGameStats(index, state);
  view.scoreLabel.textContent = "Score";
  view.score.textContent = String(state.score);
  view.streak.textContent = String(state.streak);
  view.accuracy.textContent = `${Math.round(stats.accuracy * 100)}%`;
  view.remaining.textContent = String(stats.remainingCount);
  view.progress.textContent = `${stats.guessedCount} guessed, ${stats.remainingCount} hidden`;
  view.progressFill.style.transform = `scaleX(${stats.progress.toFixed(4)})`;
}

/** Free-play capital recall: same panel, but the numbers describe the self-directed run. */
export function updateFreePlayStatsView(
  view: StatsView,
  input: { readonly found: number; readonly total: number; readonly attempts: number; readonly correct: number; readonly streak: number },
): void {
  view.scoreLabel.textContent = "Named";
  view.score.textContent = String(input.found);
  view.streak.textContent = String(input.streak);
  view.accuracy.textContent = input.attempts > 0 ? `${Math.round((input.correct / input.attempts) * 100)}%` : "100%";
  view.remaining.textContent = String(Math.max(0, input.total - input.found));
  view.progress.textContent = `${input.found} / ${input.total} capitals`;
  view.progressFill.style.transform = `scaleX(${input.total > 0 ? (input.found / input.total).toFixed(4) : "0"})`;
}
