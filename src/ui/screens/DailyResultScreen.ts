import { DAILY_MAX_SCORE, formatDailyTime } from "../../core/dailyChallenge";
import type { ShellContext } from "../shell/types";
import { fetchDailyLeaderboard, fetchDailySummary, type DailyChallengeResult, type DailyLeaderboardEntry, type DailySummary } from "../../core/auth";
import { recordDailyAchievement, type Achievement } from "../../storage/achievements";
import type { DailyResultSave } from "../../storage/dailySave";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage } from "../shell/SiteHeader";
import { shareResult } from "../shell/ResultsCard";
import { shellIcon } from "../shell/icons";
import "../../styles/daily-result.css";

export interface DailyResultScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell: ShellContext;
  readonly result: DailyResultSave;
  readonly storage: Storage;
}

export function createDailyResultScreen(options: DailyResultScreenOptions): Screen {
  let destroyed = false;
  const { result } = options;
  const achievementResult = recordDailyAchievement(options.storage, result.date);
  const shareLabel = el("span", { text: "Share" });
  const shareButton = el("button", { className: "shell-btn shell-btn-primary", attrs: { type: "button", "data-action": "share" }, children: [shellIcon("share-2", 17, 2), shareLabel] });
  const homeButton = el("button", { className: "shell-btn shell-btn-quiet", attrs: { type: "button", "data-action": "home" }, children: [el("span", { text: "Back to games" }), shellIcon("arrow-right", 17, 2)] });
  const share = el("pre", { className: "daily-share-text", text: result.shareText });
  const leaderboardPanel = el("section", { className: "daily-retention-panel daily-leaderboard-panel", children: [el("p", { className: "muted", text: "Loading today's leaderboard..." })] });
  const retentionPanel = el("section", { className: "daily-retention-panel", children: [el("p", { className: "muted", text: "Loading daily history..." })] });

  function summaryStat(label: string, value: string): HTMLElement {
    return el("article", { children: [el("span", { text: label }), el("strong", { text: value })] });
  }

  function achievementList(unlocked: readonly Achievement[]): HTMLElement {
    return el("section", {
      className: "achievement-panel",
      children: [
        el("div", { className: "achievement-panel-title", children: [el("span", { className: "eyebrow", text: unlocked.length > 0 ? "Unlocked" : "Daily streak" }), el("strong", { text: `${achievementResult.streak} day${achievementResult.streak === 1 ? "" : "s"}` })] }),
        unlocked.length > 0
          ? el("div", {
              className: "achievement-list",
              children: unlocked.map((achievement) =>
                el("article", {
                  className: "achievement-chip",
                  children: [el("strong", { text: achievement.title }), el("span", { text: achievement.description })],
                }),
              ),
            })
          : el("p", { className: "muted", text: "Come back tomorrow to keep the chain going." }),
      ],
    });
  }

  function dailyLine(entry: DailyChallengeResult): HTMLElement {
    return el("li", {
      className: "daily-history-row",
      children: [
        el("span", { text: entry.date }),
        el("strong", { text: `${entry.score}/${DAILY_MAX_SCORE}` }),
        el("span", { text: formatDailyTime(entry.timeMs) }),
      ],
    });
  }

  function renderLeaderboard(entries: readonly DailyLeaderboardEntry[] | null): void {
    if (!entries) {
      leaderboardPanel.replaceChildren(el("h2", { text: "Today's leaderboard" }), el("p", { className: "muted", text: "Leaderboard is unavailable right now." }));
      return;
    }

    leaderboardPanel.replaceChildren(
      el("h2", { text: "Today's leaderboard" }),
      el("ul", {
        className: "daily-history-list daily-leaderboard-list",
        children:
          entries.length > 0
            ? entries.map((entry) =>
                el("li", {
                  className: "daily-history-row daily-friend-row",
                  children: [
                    el("span", { className: "daily-friend-name", text: `#${entry.rank} ${entry.user.avatarEmoji ?? ""} ${entry.user.username}`.trim() }),
                    el("strong", { text: `${entry.result.score}/${DAILY_MAX_SCORE}` }),
                    el("span", { text: `${formatDailyTime(entry.result.timeMs)} · ${entry.result.hintsUsed} hints` }),
                  ],
                }),
              )
            : [el("li", { className: "daily-history-row", text: "No completed results yet." })],
      }),
    );
  }

  function renderSummary(summary: DailySummary | null): void {
    if (!summary) {
      retentionPanel.replaceChildren(el("p", { className: "muted", text: "Sign in to sync daily history and compare with friends." }));
      return;
    }

    const best = summary.best;
    const friendRows = summary.friendsToday.map((entry) =>
      el("li", {
        className: "daily-history-row daily-friend-row",
        children: [
          el("span", { className: "daily-friend-name", text: `${entry.user.avatarEmoji ?? ""} ${entry.user.username}`.trim() }),
          el("strong", { text: `${entry.result.score}/${DAILY_MAX_SCORE}` }),
          el("span", { text: formatDailyTime(entry.result.timeMs) }),
        ],
      }),
    );

    retentionPanel.replaceChildren(
      el("div", {
        className: "daily-result-stats daily-retention-stats",
        children: [
          summaryStat("Current streak", String(summary.streak)),
          summaryStat("Best recent", best ? `${best.score}/${DAILY_MAX_SCORE}` : "-"),
        ],
      }),
      el("div", {
        className: "daily-retention-grid",
        children: [
          el("section", {
            children: [
              el("h2", { text: "Recent dailies" }),
              el("ul", { className: "daily-history-list", children: summary.history.length > 0 ? summary.history.map(dailyLine) : [el("li", { className: "daily-history-row", text: "No recent results." })] }),
            ],
          }),
          el("section", {
            children: [
              el("h2", { text: "Friends today" }),
              el("ul", { className: "daily-history-list", children: friendRows.length > 0 ? friendRows : [el("li", { className: "daily-history-row", text: "No friend results yet." })] }),
            ],
          }),
        ],
      }),
    );
  }

  shareButton.addEventListener("click", () => {
    void shareResult({ text: result.shareText, title: "Locato daily challenge" }).then((outcome) => {
      if (destroyed || outcome === "shared") return;
      shareLabel.textContent = outcome === "copied" ? "Copied" : "Couldn't share";
      window.setTimeout(() => { shareLabel.textContent = "Share"; }, 1600);
    });
  });
  homeButton.addEventListener("click", () => options.shell.goHome());

  const page = createSitePage(options.shell, {
    section: "daily",
    id: "daily-result",
    className: "daily-result-screen",
    content: [
      el("div", {
        className: "daily-result-panel",
        children: [
          el("p", { className: "daily-result-kicker", text: `Daily challenge · ${result.date}` }),
          el("h1", { className: "daily-result-score", children: [el("strong", { text: String(result.score) }), el("span", { text: `/${DAILY_MAX_SCORE}` })] }),
          el("div", {
            className: "daily-result-stats",
            children: [
              el("article", { children: [el("span", { text: "Time" }), el("strong", { text: formatDailyTime(result.timeMs) })] }),
              el("article", { children: [el("span", { text: "Hints used" }), el("strong", { text: String(result.hintsUsed) })] }),
              el("article", { children: [el("span", { text: "Daily streak" }), el("strong", { text: String(achievementResult.streak) })] }),
            ],
          }),
          el("div", { className: "daily-result-actions", children: [shareButton, homeButton] }),
          share,
          el("div", { className: "daily-legend", children: [el("span", { text: "🟩 correct without hint" }), el("span", { text: "🟨 correct with hint" }), el("span", { text: "🟥 missed or skipped" })] }),
          achievementList(achievementResult.unlocked),
          leaderboardPanel,
          retentionPanel,
        ],
      }),
    ],
  });
  const element = page.element;

  void fetchDailySummary(result.date).then((summary) => {
    if (!destroyed) renderSummary(summary);
  });
  void fetchDailyLeaderboard(result.date).then((entries) => {
    if (!destroyed) renderLeaderboard(entries);
  });

  return {
    element,
    destroy: () => {
      destroyed = true;
      page.destroy();
    },
  };
}
