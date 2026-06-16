import { DAILY_MAX_SCORE, formatDailyTime } from "../../core/dailyChallenge";
import { fetchDailyLeaderboard, fetchDailySummary, type DailyChallengeResult, type DailyLeaderboardEntry, type DailySummary } from "../../core/auth";
import { recordDailyAchievement, type Achievement } from "../../storage/achievements";
import type { DailyResultSave } from "../../storage/dailySave";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface DailyResultScreenOptions {
  readonly result: DailyResultSave;
  readonly storage: Storage;
  readonly onBackToSolo: () => void;
  readonly onMultiplayer: () => void;
}

export function createDailyResultScreen(options: DailyResultScreenOptions): Screen {
  let destroyed = false;
  const { result } = options;
  const achievementResult = recordDailyAchievement(options.storage, result.date);
  const copyButton = el("button", { className: "primary-action", text: "Copy share text", attrs: { type: "button" } });
  const backButton = el("button", { className: "ghost-action nav-action", text: "Back to modes", attrs: { type: "button", "data-mobile-label": "Modes", "aria-label": "Back to game modes" } });
  const topBackButton = el("button", { className: "ghost-action nav-action", text: "Back to modes", attrs: { type: "button", "data-mobile-label": "Modes", "aria-label": "Back to game modes" } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button", "data-mobile-label": "Multi", "aria-label": "Open multiplayer" } });
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

  copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(result.shareText);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy share text";
    }, 1400);
  });
  backButton.addEventListener("click", options.onBackToSolo);
  topBackButton.addEventListener("click", options.onBackToSolo);
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
          el("div", { className: "game-header-actions", children: [topBackButton, multiplayerButton] }),
        ],
      }),
      el("div", {
        className: "daily-result-panel",
        children: [
          el("p", { className: "eyebrow", text: `Daily Challenge ${result.date}` }),
          el("h1", { text: `${result.score}/${DAILY_MAX_SCORE}` }),
          el("div", {
            className: "daily-result-stats",
            children: [
              el("article", { children: [el("span", { text: "Time" }), el("strong", { text: formatDailyTime(result.timeMs) })] }),
              el("article", { children: [el("span", { text: "Hints used" }), el("strong", { text: String(result.hintsUsed) })] }),
              el("article", { children: [el("span", { text: "Daily streak" }), el("strong", { text: String(achievementResult.streak) })] }),
            ],
          }),
          achievementList(achievementResult.unlocked),
          share,
          el("div", { className: "daily-legend", children: [el("span", { text: "🟩 correct without hint" }), el("span", { text: "🟨 correct with hint" }), el("span", { text: "🟥 missed or skipped" })] }),
          leaderboardPanel,
          retentionPanel,
          el("div", { className: "actions", children: [copyButton, backButton] }),
        ],
      }),
    ],
  });

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
    },
  };
}
