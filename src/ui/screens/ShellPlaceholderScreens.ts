import { GAME_MODE_GROUPS, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage, createSiteHeader, markShellScreen, shellIcon, type ShellContext } from "../shell";

/*
 * TEMPORARY screens for the new `compete` and `atlas` routes (docs/navigation.md). The next
 * wave replaces both; they exist so the routes resolve and the shell can be seen in place.
 */

export interface CompetePlaceholderOptions {
  readonly shell: ShellContext;
  readonly mode?: GameModeId;
  /** Opens the existing leaderboard screen for a mode until Compete shows boards itself. */
  readonly onLeaderboard: (mode: GameModeId) => void;
}

export function createCompetePlaceholderScreen(options: CompetePlaceholderOptions): Screen {
  const { shell } = options;
  const groups = GAME_MODE_GROUPS.map((group) => ({ ...group, modes: group.modes.filter((mode) => mode.leaderboard) })).filter((group) => group.modes.length);
  const list = el("div", {
    className: "compete-placeholder-groups",
    children: groups.map((group) =>
      el("section", {
        className: "compete-placeholder-group",
        children: [
          el("h2", { text: group.label }),
          el("ul", {
            children: group.modes.map((mode) =>
              el("li", {
                className: `compete-placeholder-mode${mode.id === options.mode ? " is-selected" : ""}`,
                children: [
                  el("span", { className: "compete-placeholder-icon", children: [shellIcon(mode.icon, 20, 1.6)] }),
                  el("span", { className: "compete-placeholder-copy", children: [el("strong", { text: mode.label }), el("span", { text: mode.blurb })] }),
                  el("button", { className: "shell-btn shell-btn-quiet", text: "Leaderboard", attrs: { type: "button" }, on: { click: () => options.onLeaderboard(mode.id) } }),
                  el("button", {
                    className: "shell-btn shell-btn-primary",
                    attrs: { type: "button" },
                    children: [shellIcon("timer", 16, 2), el("span", { text: "Start timed run" })],
                    on: { click: () => shell.openGame(mode.id, "timed") },
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    ),
  });
  const page = createSitePage(shell, {
    section: "compete",
    id: "compete-placeholder",
    title: "Compete",
    subtitle: "Timed runs post to the leaderboards. Pick a mode to see its board or start the clock.",
    content: [list],
  });
  return { element: page.element, destroy: page.destroy };
}

export interface AtlasPlaceholderOptions {
  readonly shell: ShellContext;
  /** The existing flag gallery screen, rendered under the shell header. */
  readonly gallery: Screen;
}

export function createAtlasPlaceholderScreen(options: AtlasPlaceholderOptions): Screen {
  const header = createSiteHeader(options.shell, { section: "learn" });
  const element = markShellScreen(
    el("section", { className: "shell-atlas-placeholder", attrs: { id: "atlas-placeholder", "data-section": "learn" }, children: [header.element, options.gallery.element] }),
    "site",
  );
  return {
    element,
    destroy: () => {
      header.destroy();
      options.gallery.destroy();
    },
  };
}
