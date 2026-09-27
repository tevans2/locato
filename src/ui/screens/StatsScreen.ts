import { fetchFullStats, type CategoryStats, type FullStats, type GameRecord } from "../../core/auth";
import type { ShellContext } from "../shell/types";
import { getCategory } from "../../core/categories";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage } from "../shell/SiteHeader";
import { ACHIEVEMENTS, getUnlockedAchievements } from "../../storage/achievements";
import { createYouHeading, createYouTabs, type YouTab } from "../components/youTabs";
import "../../styles/you.css";

export interface StatsScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell: ShellContext;
  /** Where achievements are kept (local to this browser). */
  readonly storage?: Storage;
  /** "achievements" opens that tab. Default "stats". */
  readonly initialTab?: Exclude<YouTab, "friends">;
  /** The Friends tab (its own route). */
  readonly onFriends: () => void;
  /** Called when the tab changes in place, so the URL can follow if wanted. */
  readonly onTabChange?: (tab: Exclude<YouTab, "friends">) => void;
  /** Test hook: replaces the account fetch. */
  readonly fetchStats?: () => Promise<FullStats | null>;
}

function pct(correct: number, wrong: number): string {
  const total = correct + wrong;
  return total === 0 ? "—" : `${Math.round((correct / total) * 100)}%`;
}

function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function fmtTime(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function worldModeLabel(playMode: string | null): string {
  if (playMode === "click-country") return "Click";
  if (playMode === "puzzle") return "Puzzle";
  return "Name all";
}

function heroCard(value: string, label: string, highlight = false): HTMLElement {
  return el("div", {
    className: `stats-hero-card${highlight ? " is-highlight" : ""}`,
    children: [el("strong", { className: "stats-hero-value", text: value }), el("span", { className: "stats-hero-label", text: label })],
  });
}

function statRow(label: string, value: string): HTMLElement {
  return el("div", {
    className: "stats-row",
    children: [el("span", { className: "stats-row-label", text: label }), el("span", { className: "stats-row-value", text: value })],
  });
}

function categoryBar(cat: CategoryStats): HTMLElement {
  const label = getCategory(cat.categoryId)?.label ?? cat.categoryId;
  const total = cat.correct + cat.wrong;
  const fraction = total === 0 ? 0 : cat.correct / total;
  const fill = el("div", { className: "cat-bar-fill", attrs: { style: `transform: scaleX(${fraction.toFixed(3)})` } });
  return el("div", {
    className: "cat-bar-row",
    children: [
      el("span", { className: "cat-bar-label", text: label }),
      el("div", { className: "cat-bar-track", children: [fill] }),
      el("span", { className: "cat-bar-pct", text: pct(cat.correct, cat.wrong) }),
      el("span", { className: "cat-bar-count", text: `${total}` }),
    ],
  });
}

function gameRow(record: GameRecord): HTMLElement {
  const isWorld = record.mode === "world-map";
  const modeText = isWorld ? worldModeLabel(record.playMode) : record.mode === "solo" ? "Solo" : "MP";
  const cats = isWorld ? "World map" : record.categoryIds.map((id) => getCategory(id)?.label ?? id).join(", ");
  let result: string;
  let acc: string;
  if (isWorld) {
    const found = record.countriesFound ?? 0;
    const total = record.countriesTotal ?? 0;
    result = record.completed && (record.durationMs ?? 0) > 0 ? fmtTime(record.durationMs ?? 0) : `${found}/${total}`;
    acc = record.completed ? "✓" : "—";
  } else {
    result = record.mode === "multiplayer"
      ? record.rank === 1 ? "🥇 Win" : `#${record.rank ?? "?"}/${record.totalPlayers ?? "?"}`
      : `${record.score} pts`;
    acc = pct(record.correctAnswers, record.wrongAnswers);
  }
  return el("div", {
    className: `recent-game-row${record.mode === "multiplayer" && record.rank === 1 ? " is-win" : ""}`,
    children: [
      el("span", { className: "game-row-mode", text: modeText }),
      el("span", { className: "game-row-cats", text: cats }),
      el("span", { className: "game-row-result", text: result }),
      el("span", { className: "game-row-acc", text: acc }),
      el("span", { className: "game-row-date", text: fmtDate(record.playedAt) }),
    ],
  });
}

export function buildStats(stats: FullStats, container: HTMLElement): void {
  container.replaceChildren(

    // Hero row
    el("div", {
      className: "stats-hero",
      children: [
        heroCard(String(stats.totalGames), "games played"),
        heroCard(pct(stats.totalCorrect, stats.totalWrong), "accuracy", true),
        heroCard(String(stats.bestStreak), "best streak"),
        heroCard(String(stats.multiplayerWins), "🏆 MP wins"),
      ],
    }),
    // Mode split: solo, world map, multiplayer
    el("div", {
      className: "stats-mode-grid",
      children: [
        el("section", {
          className: "stats-card stats-solo-panel",
          children: [
            el("h2", { text: "Solo" }),
            statRow("Accuracy", pct(stats.soloCorrect, stats.soloWrong)),
            statRow("Best streak", String(stats.soloBestStreak)),
            statRow("Games", String(stats.soloGames)),
            statRow("Correct", String(stats.soloCorrect)),
            statRow("Wrong", String(stats.soloWrong)),
          ],
        }),
        el("section", {
          className: "stats-card stats-world-panel",
          children: [
            el("h2", { text: "World map" }),
            statRow("Best time", fmtTime(stats.worldBestTimeMs)),
            statRow("Best countries", stats.worldBestCountries > 0 ? String(stats.worldBestCountries) : "—"),
            statRow("Games", String(stats.worldMapGames)),
            statRow("Completions", String(stats.worldMapCompletions)),
          ],
        }),
        el("section", {
          className: "stats-card stats-mp-panel",
          children: [
            el("h2", { text: "Multiplayer" }),
            statRow("Games", String(stats.multiplayerGames)),
            statRow("Wins", String(stats.multiplayerWins)),
            statRow("Win rate", stats.multiplayerGames > 0 ? `${Math.round((stats.multiplayerWins / stats.multiplayerGames) * 100)}%` : "—"),
            statRow("Correct", String(stats.multiplayerCorrect)),
            statRow("Accuracy", pct(stats.multiplayerCorrect, stats.multiplayerWrong)),
            statRow("Best streak", String(stats.multiplayerBestStreak)),
          ],
        }),
      ],
    }),

    // Per-category breakdown
    stats.categories.length > 0
      ? el("section", {
          className: "stats-card",
          children: [
            el("h2", { text: "By category" }),
            ...stats.categories.map(categoryBar),
          ],
        })
      : el("div"),

    // Recent games
    stats.recentGames.length > 0
      ? el("section", {
          className: "stats-card stats-recent",
          children: [
            el("h2", { text: "Recent games" }),
            el("div", {
              className: "recent-games-header",
              children: [
                el("span", { text: "Mode" }),
                el("span", { text: "Categories" }),
                el("span", { text: "Result" }),
                el("span", { text: "Acc" }),
                el("span", { text: "Date" }),
              ],
            }),
            ...stats.recentGames.map(gameRow),
          ],
        })
      : el("div"),
  );
}

/** Guest state for the You pages: what signing in unlocks, and the button that opens the panel. */
export function signInPrompt(shell: ShellContext, title: string, copy: string): HTMLElement {
  return el("div", {
    className: "you-guest",
    children: [
      el("p", { className: "you-guest-title", text: title }),
      el("p", { className: "you-guest-copy", text: copy }),
      el("button", { className: "shell-btn shell-btn-primary", text: "Sign in", attrs: { type: "button" }, on: { click: () => shell.openAccount() } }),
    ],
  });
}

/** Every achievement: unlocked ones first, locked ones dimmed with how to earn them. */
export function buildAchievements(storage: Storage | undefined): HTMLElement {
  const unlocked = new Set(storage ? getUnlockedAchievements(storage).map((a) => a.id) : []);
  const ordered = [...ACHIEVEMENTS].sort((a, b) => Number(unlocked.has(b.id)) - Number(unlocked.has(a.id)));
  const percent = ACHIEVEMENTS.length === 0 ? 0 : Math.round((unlocked.size / ACHIEVEMENTS.length) * 100);
  return el("div", {
    className: "you-achievements",
    children: [
      el("div", {
        className: "you-achievements-summary",
        children: [
          el("p", { className: "you-achievements-count", children: [el("strong", { text: String(unlocked.size) }), document.createTextNode(` of ${ACHIEVEMENTS.length} unlocked`)] }),
          el("div", {
            className: "you-achievements-bar",
            attrs: { role: "progressbar", "aria-label": "Achievements unlocked", "aria-valuemin": "0", "aria-valuemax": String(ACHIEVEMENTS.length), "aria-valuenow": String(unlocked.size) },
            children: [el("span", { attrs: { style: `width: ${percent}%` } })],
          }),
          el("p", { className: "you-achievements-note", text: "Achievements are kept in this browser." }),
        ],
      }),
      el("ul", {
        className: "you-achievement-grid",
        attrs: { "aria-label": "Achievements" },
        children: ordered.map((achievement) => {
          const isUnlocked = unlocked.has(achievement.id);
          return el("li", {
            className: `you-achievement${isUnlocked ? " is-unlocked" : " is-locked"}`,
            attrs: { "data-achievement": achievement.id },
            children: [
              el("span", { className: "you-achievement-seal", attrs: { "aria-hidden": "true" }, text: isUnlocked ? "✓" : "" }),
              el("span", {
                className: "you-achievement-copy",
                children: [
                  el("strong", { text: achievement.title }),
                  el("span", { text: achievement.description }),
                  el("span", { className: "you-achievement-state", text: isUnlocked ? "Unlocked" : "Locked" }),
                ],
              }),
            ],
          });
        }),
      }),
    ],
  });
}

const TAB_COPY: Readonly<Record<Exclude<YouTab, "friends">, { readonly title: string; readonly subtitle: string }>> = {
  stats: { title: "Stats", subtitle: "Every game you've played while signed in, in one place." },
  achievements: { title: "Achievements", subtitle: "Milestones from the daily challenge, practice runs and the world map." },
};

export function createStatsScreen(options: StatsScreenOptions): Screen {
  const { shell } = options;
  let tab: Exclude<YouTab, "friends"> = options.initialTab ?? "stats";
  let destroyed = false;

  const heading = createYouHeading(TAB_COPY[tab].title, TAB_COPY[tab].subtitle);
  const content = el("div", { className: "stats-content you-panel", attrs: { id: "stats-panel" } });
  const achievementsPanel = el("div", { className: "you-panel", attrs: { id: "achievements-panel" } });

  const tabs = createYouTabs(tab, (next) => {
    if (next === "friends") {
      options.onFriends();
      return;
    }
    if (next === tab) return;
    tab = next;
    show();
    options.onTabChange?.(tab);
  });

  function show(): void {
    heading.setTitle(TAB_COPY[tab].title, TAB_COPY[tab].subtitle);
    tabs.setCurrent(tab);
    content.hidden = tab !== "stats";
    achievementsPanel.hidden = tab !== "achievements";
    if (tab === "achievements") achievementsPanel.replaceChildren(buildAchievements(options.storage));
  }

  const page = createSitePage(shell, { section: "you", id: "stats", className: "you-page", content: [heading.element, tabs.element, content, achievementsPanel] });

  // Re-run when the player signs in or out (or the start-up session check resolves after mount).
  let statsRequest = 0;
  function loadStats(): void {
    const request = ++statsRequest;
    if (!shell.signedIn()) {
      content.replaceChildren(signInPrompt(shell, "Sign in to see your stats", "Accuracy, best streaks, world-map times and multiplayer wins are saved to your account."));
      return;
    }
    content.replaceChildren(el("p", { className: "stats-loading", text: "Loading stats…" }));
    void (options.fetchStats ?? fetchFullStats)().then((stats) => {
      if (destroyed || request !== statsRequest) return;
      if (!stats) {
        content.replaceChildren(signInPrompt(shell, "Couldn't load your stats", "Check your connection, or sign in again to see them."));
        return;
      }
      buildStats(stats, content);
    });
  }
  loadStats();
  const unsubscribeAuth = shell.onAuthChange?.(loadStats);
  show();

  return {
    element: page.element,
    destroy: () => {
      destroyed = true;
      unsubscribeAuth?.();
      page.destroy();
    },
  };
}
