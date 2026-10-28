import { DAILY_MAX_SCORE, DAILY_POINTS_PER_ROUND, formatDailyTime, getLocalDailyDate, type DailyRoundMark, type DailyRoundResult } from "../../core/dailyChallenge";
import { dailyThemeForDate } from "../../core/dailyThemes";
import { getCategory } from "../../core/categories";
import type { CountryIndex } from "../../core/countries";
import { findMapTapLocation } from "../../core/maptap/locations";
import type { ShellContext } from "../shell/types";
import { fetchDailyLeaderboard, fetchDailySummary, type DailyLeaderboardEntry, type DailySummary } from "../../core/auth";
import { recordDailyAchievement, type Achievement } from "../../storage/achievements";
import type { DailyResultSave } from "../../storage/dailySave";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage } from "../shell/SiteHeader";
import { shareResult } from "../shell/ResultsCard";
import { shareLink } from "../../core/shareLink";
import { shellIcon } from "../shell/icons";
import { GAME_MODE_GROUPS, gameModeCatalogueEntry, type GameModeId } from "../../core/gameModes";
import { overlandDailyNumber } from "../../core/overland/routes";
import { mysteryDailyNumber } from "../../core/mystery/round";
import "../../styles/daily-result.css";

export interface DailyResultScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell: ShellContext;
  readonly result: DailyResultSave;
  readonly storage: Storage;
  readonly countryIndex: CountryIndex;
  readonly onPractice: () => void;
  /** The signed-in player, to find their row on today's leaderboard. */
  readonly currentUserId?: string | null;
}

/** Leaderboard rows shown before the list folds down to the player's own row. */
const LEADERBOARD_TOP = 10;
const MARK_LABELS: Record<DailyRoundMark, string> = { correct: "Full points", hint: "Assisted or partial", miss: "Missed or passed" };

// Each kind of daily round, and the full game it comes from.
const DAILY_ROUND_GAMES: Readonly<Record<string, GameModeId>> = {
  flags: "flags", capitals: "capitals", shapes: "shapes", "pick-country": "click-country", "spot-country": "spot-country",
  overland: "overland", "map-tap": "map-tap", "streetview-country": "streetview-country",
};
// Older dailies have no per-round detail: suggest the games most unlike a quiz.
const FALLBACK_GAMES: readonly GameModeId[] = ["overland", "map-tap", "flags"];
const KEEP_PLAYING_COUNT = 3;
const GAME_COUNT = GAME_MODE_GROUPS.reduce((sum, group) => sum + group.modes.length, 0);

export interface KeepPlayingGame {
  readonly game: GameModeId;
  /** Points dropped on this game's rounds today, or null for an older daily without detail. */
  readonly lost: number | null;
}

/** The full games behind today's rounds, the ones that cost the most points first. */
export function keepPlayingGames(result: Pick<DailyResultSave, "rounds">): readonly KeepPlayingGame[] {
  if (!result.rounds?.length) return FALLBACK_GAMES.map((game) => ({ game, lost: null }));
  const lost = new Map<GameModeId, number>();
  for (const round of result.rounds) {
    const game = DAILY_ROUND_GAMES[round.categoryId];
    if (game) lost.set(game, (lost.get(game) ?? 0) + Math.max(0, DAILY_POINTS_PER_ROUND - round.points));
  }
  // Map order is first appearance, so ties keep the daily's own order.
  return [...lost].sort((a, b) => b[1] - a[1]).slice(0, KEEP_PLAYING_COUNT).map(([game, points]) => ({ game, lost: points }));
}

/** "Tuesday 21 October" / "Tue 21 Oct" for a daily's YYYY-MM-DD date. */
export function formatDailyDate(date: string, style: "long" | "short" = "long"): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", style === "long" ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
}

/** "7h 12m" until the next local midnight, when a new daily opens. */
export function formatUntilNextDaily(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function createDailyResultScreen(options: DailyResultScreenOptions): Screen {
  let destroyed = false;
  const { result } = options;
  const isToday = result.date === getLocalDailyDate();
  const achievementResult = recordDailyAchievement(options.storage, result.date);
  const shareLabel = el("span", { text: "Share" });
  const shareButton = el("button", { className: "shell-btn shell-btn-primary", attrs: { type: "button", "data-action": "share" }, children: [shellIcon("share-2", 17, 2), shareLabel] });
  const homeButton = el("button", { className: "shell-btn shell-btn-quiet", attrs: { type: "button", "data-action": "more-games" }, children: [el("span", { text: "Play more games" }), shellIcon("arrow-right", 17, 2)] });
  // Streak: this device's count until the account's (every device) arrives.
  const streakValue = el("strong", { text: String(achievementResult.streak) });
  const rankBadge = el("p", { className: "daily-result-rank", attrs: { hidden: "" } });
  const nextDaily = el("span", { className: "daily-next-countdown" });
  const leaderboardPanel = el("section", { className: "daily-side-panel daily-leaderboard-panel", children: [el("h2", { text: "Today's leaderboard" }), el("p", { className: "muted", text: "Loading today's leaderboard..." })] });
  const retentionPanel = el("div", { className: "daily-retention-panel", children: [el("p", { className: "muted", text: "Loading daily history..." })] });
  const practiceRounds = result.rounds?.filter((round) => round.points < DAILY_POINTS_PER_ROUND) ?? [];

  function roundExplanation(round: DailyRoundResult): string {
    if (round.missed) return "Passed or revealed · 0 points";
    if (round.categoryId === "map-tap") return `${Math.round(round.distanceKm ?? 0).toLocaleString("en-US")} km from target · ${10 - round.points} points lost`;
    if (round.points === 10) return "Correct first time";
    const wrong = round.categoryId === "overland" ? "extra guess" : "wrong guess";
    const reasons = [round.hintsUsed > 0 ? `${round.hintsUsed} hint${round.hintsUsed === 1 ? "" : "s"}` : "", round.wrongGuesses > 0 ? `${round.wrongGuesses} ${wrong}${round.wrongGuesses === 1 ? "" : "es"}` : ""].filter(Boolean);
    return `${reasons.join(" · ")} · ${10 - round.points} points lost`;
  }

  // The share grid, drawn as tiles (the Share button copies the text version).
  const tiles = el("ol", { className: "daily-tiles", attrs: { "aria-label": "Rounds at a glance" }, children: result.marks.map((mark, position) =>
    el("li", { className: `daily-tile is-${mark}`, attrs: { title: `Round ${position + 1}: ${MARK_LABELS[mark]}`, "aria-label": `Round ${position + 1}: ${MARK_LABELS[mark]}` } })) });

  const recap = el("section", { className: "daily-recap", attrs: { "aria-label": "Round by round review" }, children: [
    el("div", { className: "daily-recap-heading", children: [el("h2", { text: "Your world tour" }),
      el("div", { className: "daily-legend", children: (["correct", "hint", "miss"] as const).map((mark) => el("span", { children: [el("i", { className: `daily-tile is-${mark}` }), el("span", { text: MARK_LABELS[mark] })] })) })] }),
    result.rounds?.length
      ? el("ol", { className: "daily-recap-list", children: result.rounds.map((round, position) => {
          const country = round.countryCode ? options.countryIndex.byCode.get(round.countryCode) : undefined;
          const location = round.targetId && round.categoryId === "map-tap" ? findMapTapLocation(round.targetId) : undefined;
          const routeEnds = round.categoryId === "overland" ? (round.targetId ?? "").split("-").map((code) => options.countryIndex.byCode.get(code)?.name ?? code) : null;
          const answer = routeEnds ? routeEnds.join(" → ") : location ? location.name
            : round.categoryId === "capitals" ? `${country?.capital ?? ""} → ${country?.name ?? round.countryCode}` : country?.name ?? round.countryCode ?? "";
          const label = round.categoryId === "map-tap" ? "Map Tap" : round.categoryId === "streetview-country" ? "Street View" : round.categoryId === "overland" ? "Overland" : getCategory(round.categoryId)?.label ?? round.categoryId;
          const mark = result.marks[position] ?? (round.points === DAILY_POINTS_PER_ROUND ? "correct" : round.points > 0 ? "hint" : "miss");
          return el("li", { className: `daily-recap-row is-${mark}${round.points < 10 ? " has-loss" : ""}`, children: [
            el("span", { className: "daily-recap-number", text: String(position + 1) }),
            el("div", { className: "daily-recap-answer", children: [el("span", { className: "daily-recap-mode", text: label }), el("strong", { text: answer }), el("span", { className: "daily-recap-reason", text: roundExplanation(round) })] }),
            el("strong", { className: "daily-recap-points", text: `${round.points}/10` }),
          ] });
        }) })
      : el("p", { className: "muted", text: "Detailed review is available for newly played daily challenges." }),
    ...(practiceRounds.length ? [el("div", { className: "daily-practice-cta", children: [
        el("p", { text: `Revisit ${practiceRounds.length} question${practiceRounds.length === 1 ? "" : "s"} where you lost points. Practice won't change your daily score.` }),
        el("button", { className: "shell-btn shell-btn-primary", text: "Practise what you missed", attrs: { type: "button", "data-action": "practice-daily" }, on: { click: options.onPractice } })] })]
      : result.rounds ? [el("p", { className: "daily-clean-sweep", text: "A perfect tour — every round earned full points." })] : []),
  ] });

  // Straight after the score: the games behind today's rounds, so the daily leads into the rest of Locato.
  const keepPlaying = el("section", { className: "daily-keep-playing", attrs: { "aria-labelledby": "daily-keep-playing-title", tabindex: "-1" }, children: [
    el("div", { className: "daily-keep-heading", children: [
      el("h2", { attrs: { id: "daily-keep-playing-title" }, text: "Keep playing" }),
      el("p", { className: "muted", text: `Every round today comes from a full game you can play as much as you like.${isToday ? " The daily is once a day; these aren't." : ""}` }),
    ] }),
    el("ul", { className: "daily-keep-games", children: keepPlayingGames(result).map(({ game, lost }) => {
      const mode = gameModeCatalogueEntry(game);
      const note = lost === null ? null : lost > 0 ? `You dropped ${lost} point${lost === 1 ? "" : "s"} here today` : "Full marks today";
      return el("li", { children: [el("button", {
        className: "daily-keep-card", attrs: { type: "button", "data-action": "keep-playing", "data-game": game },
        on: { click: () => options.shell.openGame(game, "practice") },
        children: [
          el("span", { className: "daily-keep-icon", attrs: { "aria-hidden": "true" }, children: [shellIcon(mode.icon, 20, 1.7)] }),
          el("span", { className: "daily-keep-copy", children: [
            el("strong", { text: mode.label }),
            ...(note ? [el("span", { className: `daily-keep-note${lost ? " is-loss" : ""}`, text: note })] : []),
            el("span", { className: "daily-keep-description", text: mode.blurb }),
          ] }),
          el("span", { className: "daily-keep-cta", children: [el("span", { text: "Play" }), shellIcon("arrow-right", 16, 2)] }),
        ],
      })] });
    }) }),
    el("div", { className: "daily-keep-more", children: [
      ...(isToday && options.shell.openDailyPuzzle ? [el("p", { children: [
        el("span", { text: "Two more daily puzzles:" }),
        el("button", { className: "daily-keep-link", attrs: { type: "button", "data-action": "daily-overland" }, on: { click: () => options.shell.openDailyPuzzle?.("overland") }, children: [shellIcon("route", 15, 1.8), el("span", { text: `Overland #${overlandDailyNumber(result.date)}` })] }),
        el("button", { className: "daily-keep-link", attrs: { type: "button", "data-action": "daily-mystery" }, on: { click: () => options.shell.openDailyPuzzle?.("mystery") }, children: [shellIcon("compass", 15, 1.8), el("span", { text: `Mystery country #${mysteryDailyNumber(result.date)}` })] }),
      ] })] : []),
      el("button", { className: "shell-btn shell-btn-quiet", attrs: { type: "button", "data-action": "all-games" }, on: { click: () => options.shell.openGamePicker() }, children: [shellIcon("layout-grid", 16, 1.8), el("span", { text: `Browse all ${GAME_COUNT} games` })] }),
    ] }),
  ] });

  function summaryStat(label: string, value: string | HTMLElement): HTMLElement {
    return el("article", { children: [el("span", { text: label }), typeof value === "string" ? el("strong", { text: value }) : value] });
  }

  function playerName(user: { readonly avatarEmoji: string | null; readonly username: string }): HTMLElement {
    return el("span", { className: "daily-friend-name", children: [el("span", { className: "daily-avatar", text: user.avatarEmoji ?? "", attrs: { "aria-hidden": "true" } }), el("span", { text: user.username })] });
  }

  function leaderboardRow(entry: DailyLeaderboardEntry, mine: boolean): HTMLElement {
    return el("li", {
      className: `daily-history-row daily-board-row${mine ? " is-you" : ""}`,
      children: [
        el("span", { className: "daily-board-rank", text: `#${entry.rank}` }),
        playerName(entry.user),
        ...(mine ? [el("span", { className: "daily-you-pill", text: "You" })] : []),
        el("strong", { text: `${entry.result.score}` }),
        el("span", { className: "daily-board-time", text: formatDailyTime(entry.result.timeMs) }),
      ],
    });
  }

  /** The board API returns at most 100 rows, so a full page means "100 or more". */
  function playerCount(entries: readonly DailyLeaderboardEntry[]): string {
    return entries.length >= 100 ? "100+" : String(entries.length);
  }

  function renderLeaderboard(entries: readonly DailyLeaderboardEntry[] | null): void {
    const heading = el("div", { className: "daily-side-heading", children: [el("h2", { text: isToday ? "Today's leaderboard" : "Leaderboard" }), ...(entries?.length ? [el("span", { className: "muted", text: `${playerCount(entries)} player${entries.length === 1 ? "" : "s"}` })] : [])] });
    if (!entries) {
      leaderboardPanel.replaceChildren(heading, el("p", { className: "muted", text: "Leaderboard is unavailable right now." }));
      return;
    }
    const mine = options.currentUserId ? entries.find((entry) => entry.user.id === options.currentUserId) : undefined;
    if (mine) {
      rankBadge.hidden = false;
      rankBadge.replaceChildren(el("strong", { text: `#${mine.rank}` }), el("span", { text: ` of ${playerCount(entries)} today` }));
    }
    const top = entries.slice(0, LEADERBOARD_TOP);
    const rows = top.map((entry) => leaderboardRow(entry, entry === mine));
    if (mine && mine.rank > LEADERBOARD_TOP) rows.push(el("li", { className: "daily-board-gap", text: "…", attrs: { "aria-hidden": "true" } }), leaderboardRow(mine, true));
    leaderboardPanel.replaceChildren(
      heading,
      el("ol", { className: "daily-history-list daily-leaderboard-list", children: rows.length > 0 ? rows : [el("li", { className: "daily-history-row", text: "No completed results yet." })] }),
    );
  }

  function renderSummary(summary: DailySummary | null): void {
    if (!summary) {
      retentionPanel.replaceChildren(el("section", { className: "daily-side-panel daily-guest-cta", children: [
        el("h2", { text: "Keep your streak" }),
        el("p", { className: "muted", text: "Sign in to save this result to your account, keep your streak on every device and compare with friends." }),
        el("button", { className: "shell-btn shell-btn-primary", text: "Sign in", attrs: { type: "button" }, on: { click: () => options.shell.openAccount() } }),
      ] }));
      return;
    }

    streakValue.textContent = String(summary.streak);
    const friendRows = summary.friendsToday.map((entry) =>
      el("li", {
        className: "daily-history-row daily-friend-row",
        children: [playerName(entry.user), el("strong", { text: `${entry.result.score}` }), el("span", { className: "daily-board-time", text: formatDailyTime(entry.result.timeMs) })],
      }),
    );
    const best = summary.best;

    retentionPanel.replaceChildren(
      el("section", { className: "daily-side-panel", children: [
        el("div", { className: "daily-side-heading", children: [el("h2", { text: "Friends today" })] }),
        el("ul", { className: "daily-history-list", children: friendRows.length > 0 ? friendRows : [el("li", { className: "daily-history-row daily-empty-row", text: "No friend results yet." })] }),
      ] }),
      el("section", { className: "daily-side-panel", children: [
        el("div", { className: "daily-side-heading", children: [el("h2", { text: "Your recent dailies" }), ...(best ? [el("span", { className: "muted", text: `Best ${best.score}` })] : [])] }),
        el("ul", { className: "daily-history-list", children: summary.history.length > 0
          ? summary.history.map((entry) => el("li", {
              className: `daily-history-row${entry.date === result.date ? " is-you" : ""}`,
              children: [
                el("span", { text: formatDailyDate(entry.date, "short") }),
                el("span", { className: "daily-history-bar", attrs: { "aria-hidden": "true" }, children: [el("i", { attrs: { style: `width: ${Math.round((entry.score / DAILY_MAX_SCORE) * 100)}%` } })] }),
                el("strong", { text: `${entry.score}` }),
              ],
            }))
          : [el("li", { className: "daily-history-row daily-empty-row", text: "No recent results." })] }),
      ] }),
    );
  }

  shareButton.addEventListener("click", () => {
    void shareResult({ text: `${result.shareText}\n${shareLink({ view: "daily-challenge" })}`, title: "Locato daily challenge" }).then((outcome) => {
      if (destroyed || outcome === "shared") return;
      shareLabel.textContent = outcome === "copied" ? "Copied" : "Couldn't share";
      window.setTimeout(() => { shareLabel.textContent = "Share"; }, 1600);
    });
  });
  homeButton.addEventListener("click", () => {
    keepPlaying.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    keepPlaying.focus({ preventScroll: true });
  });

  const renderCountdown = () => { nextDaily.textContent = `Next daily in ${formatUntilNextDaily(new Date())}`; };
  renderCountdown();
  const countdownTimer = isToday ? window.setInterval(renderCountdown, 30_000) : null;

  const page = createSitePage(options.shell, {
    section: "daily",
    id: "daily-result",
    className: "daily-result-screen",
    content: [
      el("div", {
        className: "daily-result-panel",
        children: [
          el("header", { className: "daily-result-hero", children: [
            el("p", { className: "daily-result-kicker", text: `Daily challenge · ${formatDailyDate(result.date)}` }),
            ...(result.challengeVersion === 2 ? [el("h2", { className: "daily-result-theme", text: dailyThemeForDate(result.date).title })] : []),
            el("div", { className: "daily-result-headline", children: [
              el("h1", { className: "daily-result-score", children: [el("strong", { text: String(result.score) }), el("span", { text: `/${DAILY_MAX_SCORE}` })] }),
              rankBadge,
            ] }),
            tiles,
            el("div", {
              className: "daily-result-stats",
              children: [
                summaryStat("Time", formatDailyTime(result.timeMs)),
                summaryStat("Hints used", String(result.hintsUsed)),
                summaryStat("Daily streak", streakValue),
              ],
            }),
            el("div", { className: "daily-result-actions", children: [shareButton, homeButton, ...(isToday ? [nextDaily] : [])] }),
            ...(achievementResult.unlocked.length > 0 ? [el("section", { className: "achievement-panel", children: [
              el("div", { className: "achievement-panel-title", children: [el("span", { className: "eyebrow", text: "Unlocked" }), el("strong", { text: `${achievementResult.unlocked.length} achievement${achievementResult.unlocked.length === 1 ? "" : "s"}` })] }),
              el("div", { className: "achievement-list", children: achievementResult.unlocked.map((achievement: Achievement) => el("article", { className: "achievement-chip", children: [el("strong", { text: achievement.title }), el("span", { text: achievement.description })] })) }),
            ] })] : []),
          ] }),
          keepPlaying,
          el("div", { className: "daily-result-layout", children: [
            el("div", { className: "daily-result-main", children: [recap] }),
            el("aside", { className: "daily-result-side", children: [leaderboardPanel, retentionPanel] }),
          ] }),
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
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      page.destroy();
    },
  };
}
