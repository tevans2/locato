import { fetchFullStats, type CategoryStats, type FullStats, type GameRecord } from "../../core/auth";
import { getCategory } from "../../core/categories";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface StatsScreenOptions {
  readonly onBack: () => void;
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

export function createStatsScreen(options: StatsScreenOptions): Screen {
  const backButton = el("button", { className: "ghost-action screen-back-button", text: "Back", attrs: { type: "button", "aria-label": "Back to game" } });
  backButton.addEventListener("click", options.onBack);

  const logo = el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });

  const content = el("div", { className: "stats-content" });
  const loading = el("p", { className: "stats-loading", text: "Loading stats…" });
  content.appendChild(loading);

  const element = el("section", {
    className: "game-screen stats-screen",
    children: [
      el("header", {
        className: "stats-header",
        children: [el("div", { className: "stats-header-title", children: [logo, el("h1", { text: "Stats" })] }), backButton],
      }),
      content,
    ],
  });

  void fetchFullStats().then((stats) => {
    if (!stats) {
      content.replaceChildren(el("p", { className: "stats-loading", text: "Sign in to see your stats." }));
      return;
    }
    buildStats(stats, content);
  });

  return { element, destroy: () => undefined };
}
