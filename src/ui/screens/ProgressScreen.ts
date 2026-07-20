import { getGameModeOption, timerGameModeOptions, type GameModeId, type TimerGameModeId } from "../../core/gameModes";
import { getLocalDailyDate } from "../../core/dailyChallenge";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatStoredTime, readStoredTime } from "../../core/timer/playTimer";
import { ACHIEVEMENTS, getAchievementState } from "../../storage/achievements";
import { readSettings, saveSettings } from "../../storage/settings";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createBrandLockup } from "../dom/createBrandLockup";

const CONTINENTS = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"] as const;

export interface ProgressScreenOptions {
  readonly storage: Storage;
  readonly onHome: () => void;
  readonly onBack: () => void;
  readonly onPlayMode: (mode: GameModeId) => void;
  readonly onStats: () => void;
  readonly onDailyChallenge: () => void;
}

function progressCard(value: string, label: string, detail: string): HTMLElement {
  return el("article", {
    className: "journey-summary-card",
    children: [
      el("strong", { text: value }),
      el("span", { text: label }),
      el("small", { text: detail }),
    ],
  });
}

function toggleRow(label: string, description: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el("input", { attrs: { type: "checkbox", ...(checked ? { checked: "" } : {}) } }) as HTMLInputElement;
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", {
    className: "journey-setting-row",
    children: [el("span", { children: [el("strong", { text: label }), el("small", { text: description })] }), input],
  });
}

function recentDateKeys(days: number): readonly { readonly key: string; readonly label: string }[] {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - index - 1));
    return { key: getLocalDailyDate(date), label: formatter.format(date) };
  });
}

export function createProgressScreen(options: ProgressScreenOptions): Screen {
  const state = getAchievementState(options.storage);
  const unlocked = new Set(state.unlockedIds);
  const unlockedCount = ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id)).length;
  const continentMilestones = state.completedWorldContinents.length + state.completedNoHintSoloContinents.length;
  let settings = readSettings(options.storage);
  const recentDays = recentDateKeys(7);
  const playedDailyDates = new Set(state.dailyDates);
  const weekDailyCount = recentDays.filter((day) => playedDailyDates.has(day.key)).length;
  const personalBests = timerGameModeOptions
    .map((mode) => {
      const keys = timerKeysForMode(mode.id as TimerGameModeId);
      return { mode, best: readStoredTime(options.storage, keys.best), last: readStoredTime(options.storage, keys.last) };
    })
    .filter((entry) => entry.best !== null)
    .sort((a, b) => (a.best ?? Number.MAX_SAFE_INTEGER) - (b.best ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 4);

  const backButton = el("button", { className: "ghost-action screen-back-button", text: "Back", attrs: { type: "button" }, on: { click: options.onBack } });
  const statsButton = el("button", { className: "ghost-action screen-header-action", text: "Full stats", attrs: { type: "button" }, on: { click: options.onStats } });

  const nextChallenge = !unlocked.has("daily-first")
    ? { title: "Daily foothold", detail: "Complete today's shared route.", action: "Play daily", run: options.onDailyChallenge }
    : !unlocked.has("solo-streak-25")
      ? { title: "Hot hand", detail: "Build a 25-answer streak in Flags.", action: "Play flags", run: () => options.onPlayMode("flags") }
      : { title: "Map generalist", detail: "Complete Name, Click, and Spot modes.", action: "Open world map", run: () => options.onPlayMode("name-all") };

  const element = el("section", {
    className: "game-screen journey-screen",
    children: [
      el("header", {
        className: "stats-header",
        children: [
          el("div", { className: "stats-header-title", children: [createBrandLockup(options.onHome), el("h1", { text: "Your journey" })] }),
          el("div", { className: "screen-header-actions", children: [statsButton, backButton] }),
        ],
      }),
      el("div", {
        className: "journey-content",
        children: [
          el("section", {
            className: "journey-summary",
            attrs: { "aria-label": "Progress summary" },
            children: [
              progressCard(`${unlockedCount}/${ACHIEVEMENTS.length}`, "Achievements", "Permanent milestones"),
              progressCard(String(state.bestDailyStreak), "Best daily streak", "Days in a row"),
              progressCard(String(state.completedWorldModes.length), "World modes", "Completed map modes"),
              progressCard(String(continentMilestones), "Continent feats", "Clean sweeps and map fills"),
            ],
          }),
          el("section", {
            className: "journey-next-card",
            children: [
              el("div", { children: [el("span", { className: "eyebrow", text: "Recommended next" }), el("h2", { text: nextChallenge.title }), el("p", { text: nextChallenge.detail })] }),
              el("button", { className: "primary-action", text: nextChallenge.action, attrs: { type: "button" }, on: { click: nextChallenge.run } }),
            ],
          }),
          el("section", {
            className: "journey-panel journey-streak-panel",
            children: [
              el("div", { className: "journey-panel-heading", children: [el("h2", { text: "This week's trail" }), el("span", { text: `${weekDailyCount}/3 daily runs` })] }),
              el("div", {
                className: "journey-week",
                attrs: { "aria-label": `${weekDailyCount} daily challenges completed in the last seven days` },
                children: recentDays.map((day) => el("div", {
                  className: `journey-day${playedDailyDates.has(day.key) ? " is-played" : ""}`,
                  children: [el("span", { text: day.label }), el("strong", { text: playedDailyDates.has(day.key) ? "✓" : "·" })],
                })),
              }),
              el("p", { className: "journey-week-copy", text: weekDailyCount >= 3 ? "Weekly trail complete — keep the streak alive." : `Complete ${3 - weekDailyCount} more daily ${3 - weekDailyCount === 1 ? "run" : "runs"} to finish this week's trail.` }),
            ],
          }),
          el("section", {
            className: "journey-panel",
            children: [
              el("div", { className: "journey-panel-heading", children: [el("h2", { text: "Personal bests" }), el("span", { text: personalBests.length > 0 ? "Fastest completed runs" : "Turn on Timer mode to begin" })] }),
              personalBests.length > 0
                ? el("div", {
                    className: "journey-best-grid",
                    children: personalBests.map(({ mode, best, last }) => el("button", {
                      className: "journey-best-card",
                      attrs: { type: "button" },
                      on: { click: () => options.onPlayMode(mode.id) },
                      children: [
                        el("span", { text: getGameModeOption(mode.id).label }),
                        el("strong", { text: formatStoredTime(best) }),
                        el("small", { text: last !== null && best !== null && last > best ? `${formatStoredTime(last - best)} off your best` : "Personal record" }),
                      ],
                    })),
                  })
                : el("p", { className: "muted", text: "Choose Timer mode in any prompt or world-map game. Your best runs will appear here." }),
            ],
          }),
          el("section", {
            className: "journey-panel",
            children: [
              el("div", { className: "journey-panel-heading", children: [el("h2", { text: "Map mastery" }), el("span", { text: "Continent milestones" })] }),
              el("div", {
                className: "journey-continent-grid",
                children: CONTINENTS.map((continent) => {
                  const mapComplete = state.completedWorldContinents.includes(continent);
                  const cleanSweep = state.completedNoHintSoloContinents.includes(continent);
                  const level = Number(mapComplete) + Number(cleanSweep);
                  return el("button", {
                    className: `journey-continent-card level-${level}`,
                    attrs: { type: "button", "aria-label": `${continent}: ${level} of 2 mastery milestones` },
                    on: { click: () => options.onPlayMode("name-all") },
                    children: [
                      el("strong", { text: continent }),
                      el("span", { text: `${level}/2 mastery` }),
                      el("small", { text: cleanSweep ? "Map complete · clean solo sweep" : mapComplete ? "Map complete · clean sweep remains" : "Complete its map and a clean solo sweep" }),
                    ],
                  });
                }),
              }),
            ],
          }),
          el("section", {
            className: "journey-panel",
            children: [
              el("div", { className: "journey-panel-heading", children: [el("h2", { text: "Achievements" }), el("span", { text: `${unlockedCount} unlocked` })] }),
              el("div", {
                className: "journey-achievement-grid",
                children: ACHIEVEMENTS.map((achievement) => {
                  const isUnlocked = unlocked.has(achievement.id);
                  return el("article", {
                    className: `journey-achievement${isUnlocked ? " is-unlocked" : " is-locked"}`,
                    children: [
                      el("span", { className: "journey-achievement-mark", text: isUnlocked ? "✓" : "○", attrs: { "aria-hidden": "true" } }),
                      el("div", { children: [el("strong", { text: achievement.title }), el("p", { text: achievement.description })] }),
                    ],
                  });
                }),
              }),
            ],
          }),
          el("section", {
            className: "journey-panel",
            children: [
              el("div", { className: "journey-panel-heading", children: [el("h2", { text: "Game feel" }), el("span", { text: "On this device" })] }),
              toggleRow("Sound effects", "Short tones for answers and completions.", settings.soundEnabled, (checked) => {
                settings = { ...settings, soundEnabled: checked };
                saveSettings(options.storage, settings);
              }),
              toggleRow("Haptic feedback", "Subtle vibration on supported devices.", settings.hapticsEnabled, (checked) => {
                settings = { ...settings, hapticsEnabled: checked };
                saveSettings(options.storage, settings);
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return { element, destroy: () => undefined };
}
