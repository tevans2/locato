import { gameModeCatalogueEntry, gameModeGroupOf, isLeaderboardMode, type GameModeId } from "../../core/gameModes";
import { isSingleRunMode, leaderboardConfig, runLabels } from "../../core/leaderboards";
import { el } from "../dom/createElement";
import { createPreferenceMenuItems } from "./controls";
import { openGamePicker } from "./GamePicker";
import { shellIcon, type ShellIconName } from "./icons";
import { focusableIn, trapOverlay } from "./layer";
import { SITE_SECTIONS, type RunType, type ShellContext, type SiteSection } from "./types";
import "../../styles/shell.css";

export interface GameBarMenuItem {
  readonly label: string;
  readonly icon?: ShellIconName;
  readonly onSelect: () => void;
}

export interface GameBarOptions {
  readonly gameMode: GameModeId;
  readonly run: RunType;
  /** Live clock for timed runs (shown in the run pill). Swap it later with `setClock`. */
  readonly clock?: HTMLElement;
  /** ← Back. Usually `() => ctx.goBack("play")` (or "leaderboards" for timed runs). */
  readonly onBack: () => void;
  /** Accessible name for ←, saying where it goes. Default "Back". */
  readonly backLabel?: string;
  /** "How to play" row at the top of the ⋯ menu. */
  readonly onHowToPlay?: () => void;
  /** Mode-specific rows (e.g. "Restart run", "Flag set…"), listed after How to play. */
  readonly extraMenuItems?: readonly GameBarMenuItem[];
  /**
   * Return a message when leaving now would discard progress (a timed run in progress, a
   * multiplayer room). GameBar then asks `ctx.confirmLeave(message)` before Back, switching
   * game, or following a section link. Return null when it is safe to leave.
   */
  readonly leaveGuard?: () => string | null;
  /**
   * The board variant to open when switching Practice → Timed (the flag set, the puzzle
   * continent). Read at click time.
   */
  readonly timedVariant?: () => string | undefined;
  /** Single-run modes: the "Best" badge's value (e.g. "1,240"). Update it with `setBest`. */
  readonly best?: string | null;
}

export interface GameBarHandle {
  readonly element: HTMLElement;
  readonly setClock: (clock: HTMLElement | null) => void;
  /** Single-run modes: update the "Best" badge (null shows "—"). */
  readonly setBest: (best: string | null) => void;
  /** Open the ⋯ menu programmatically (e.g. from a keyboard shortcut). */
  readonly openMenu: () => void;
  readonly destroy: () => void;
}

async function guarded(ctx: ShellContext, guard: GameBarOptions["leaveGuard"], action: () => void, title = "Leave this run?"): Promise<void> {
  const message = guard?.() ?? null;
  if (message && !(await ctx.confirmLeave(message, { title, confirmLabel: "Leave", cancelLabel: "Keep playing", tone: "danger" }))) return;
  action();
}

/**
 * Layout 2 ("Game screen") bar: ← back · the game's name as a switcher (opens the picker) ·
 * the run type (Practice / Timed + clock) · ⋯ menu with how to play, sound, theme, account
 * and the section links. The page-to-page links live in the menu, never across the bar.
 */
export function createGameBar(ctx: ShellContext, options: GameBarOptions): GameBarHandle {
  const controller = new AbortController();
  const { signal } = controller;
  const mode = gameModeCatalogueEntry(options.gameMode);
  const group = gameModeGroupOf(options.gameMode);
  const timed = options.run === "timed";
  // Score boards (MapTap, Worldsplit, GeoGuessr, Street View country) have no clock: their
  // "timed" run is a fixed-length ranked attempt, shown to players as "Ranked".
  const ranked = timed && leaderboardConfig(options.gameMode)?.metric === "score";
  const leaveTitle = ranked ? "Ranked attempt in progress" : "Leave this run?";

  const back = el("button", {
    className: "shell-icon-btn shell-gamebar-back",
    attrs: { type: "button", "aria-label": options.backLabel ?? "Back", title: options.backLabel ?? "Back" },
    children: [shellIcon("arrow-left", 20, 2)],
  });
  back.addEventListener("click", () => void guarded(ctx, options.leaveGuard, options.onBack, leaveTitle), { signal });

  const switcher = el("button", {
    className: "shell-switcher",
    attrs: { type: "button", "aria-haspopup": "dialog", "aria-label": `${mode.label}. Switch game`, "data-group": group.id },
    children: [
      el("span", { className: "shell-switcher-icon", children: [shellIcon(mode.icon, 18, 1.7)] }),
      el("span", {
        className: "shell-switcher-copy",
        children: [el("span", { className: "shell-switcher-group", text: group.label }), el("span", { className: "shell-switcher-name", text: mode.label })],
      }),
      el("span", { className: "shell-switcher-caret", children: [shellIcon("chevron-down", 16, 2)] }),
    ],
  });
  switcher.addEventListener("click", () => {
    switcher.setAttribute("aria-expanded", "true");
    openGamePicker({
      current: options.gameMode,
      currentRun: options.run,
      title: "Switch game",
      onClose: () => switcher.setAttribute("aria-expanded", "false"),
      onPick: (next, run) => {
        if (next === options.gameMode && run === options.run) return;
        void guarded(ctx, options.leaveGuard, () => ctx.openGame(next, run), leaveTitle);
      },
    });
  }, { signal });
  switcher.setAttribute("aria-expanded", "false");

  // ---- Run type -----------------------------------------------------------------------------
  // Split modes: a two-way switch (Practice | Timed, or Custom | Ranked for MapTap) that opens the
  // other run of this game. Single-run modes: a "Best" badge — every run counts, nothing to pick.
  // Modes without a board show a plain Practice label.
  const clockSlot = el("span", { className: "shell-run-clock" });
  const single = isSingleRunMode(options.gameMode);
  const bestValue = el("strong", { className: "shell-run-best-value", text: options.best ?? "—" });
  let pill: HTMLElement;
  if (single) {
    pill = el("span", {
      className: "shell-run-pill shell-run-best is-single",
      attrs: { "data-run": "single", title: "Every finished run counts — your best score is on the leaderboard" },
      children: [shellIcon("trophy", 15, 2.1), el("span", { className: "shell-run-label", text: "Best" }), bestValue, clockSlot],
    });
  } else if (isLeaderboardMode(options.gameMode)) {
    const labels = runLabels(options.gameMode);
    const scoreBoard = leaderboardConfig(options.gameMode)?.metric === "score";
    const option = (run: RunType): HTMLButtonElement => {
      const active = run === options.run;
      const label = run === "timed" ? labels.timed : labels.practice;
      const button = el("button", {
        className: `shell-run-option is-${run}${active ? " is-active" : ""}`,
        attrs: {
          type: "button",
          "data-run": run,
          "aria-pressed": String(active),
          title: run === "practice"
            ? `${label} — ${options.gameMode === "map-tap" ? "pick your own settings" : "no clock"}, nothing is posted`
            : `${label} — ${scoreBoard ? "fixed settings, your total posts" : "against the clock, your time posts"} to the leaderboard`,
        },
        children: [
          ...(run === "timed" ? [shellIcon(scoreBoard ? "trophy" : "timer", 14, 2.1)] : []),
          el("span", { className: `shell-run-option-label${active ? " shell-run-label" : ""}`, text: label }),
          ...(active ? [clockSlot] : []),
        ],
      });
      if (!active) {
        button.addEventListener("click", () => void guarded(ctx, options.leaveGuard, () => ctx.openGame(options.gameMode, run, run === "timed" ? options.timedVariant?.() : undefined), leaveTitle), { signal });
      }
      return button;
    };
    pill = el("div", {
      className: `shell-run-pill shell-run-switch is-${options.run}`,
      attrs: { role: "group", "aria-label": "Run type", "data-run": options.run, ...(ranked ? { "data-ranked": "true" } : {}) },
      children: [option("practice"), option("timed")],
    });
  } else {
    pill = el("span", {
      className: "shell-run-pill is-practice",
      attrs: { "data-run": "practice", title: "Practice — no clock, nothing is posted" },
      children: [el("span", { className: "shell-run-dot", attrs: { "aria-hidden": "true" } }), el("span", { className: "shell-run-label", text: "Practice" }), clockSlot],
    });
  }
  const setClock = (clock: HTMLElement | null): void => {
    clockSlot.replaceChildren(...(clock ? [clock] : []));
    pill.classList.toggle("has-clock", Boolean(clock));
  };
  setClock(options.clock ?? null);
  const setBest = (best: string | null): void => {
    bestValue.textContent = best ?? "—";
  };

  // ---- ⋯ menu -------------------------------------------------------------------------------
  const menuButton = el("button", {
    className: "shell-icon-btn shell-gamebar-more",
    attrs: { type: "button", "aria-label": "Menu", "aria-haspopup": "menu", "aria-expanded": "false", title: "Menu" },
    children: [shellIcon("ellipsis", 20, 2.2)],
  });

  const menuRow = (label: string, iconName: ShellIconName, onSelect: () => void, extra: Record<string, string> = {}): HTMLButtonElement =>
    el("button", {
      className: "shell-menu-item",
      attrs: { type: "button", role: "menuitem", ...extra },
      children: [el("span", { className: "shell-menu-icon", children: [shellIcon(iconName, 18)] }), el("span", { className: "shell-menu-label", text: label })],
      // Focus goes back to ⋯ first, so a dialog the row opens returns focus there, not to a hidden row.
      on: { click: () => { closeMenu(); onSelect(); } },
    });

  const topRows: HTMLButtonElement[] = [];
  if (options.onHowToPlay) topRows.push(menuRow("How to play", "help", options.onHowToPlay));
  for (const item of options.extraMenuItems ?? []) topRows.push(menuRow(item.label, item.icon ?? "arrow-right", item.onSelect));
  const preferenceRows = createPreferenceMenuItems(ctx.storage, signal);
  const accountRow = menuRow(ctx.signedIn() ? "Account" : "Sign in", "user-round", () => ctx.openAccount());
  const sectionRows = SITE_SECTIONS.map((section) =>
    menuRow(section.label, section.icon, () => void guarded(ctx, options.leaveGuard, () => ctx.openSection(section.id as SiteSection), leaveTitle), { "data-section": section.id }),
  );

  const sep = (): HTMLElement => el("div", { className: "shell-menu-sep", attrs: { role: "separator" } });
  const menuLabel = (text: string): HTMLElement => el("div", { className: "shell-menu-heading", text, attrs: { role: "presentation" } });

  const menu = el("div", {
    className: "shell-menu",
    attrs: { role: "menu", "aria-label": "Game menu", tabindex: "-1" },
    children: [
      ...(topRows.length ? [...topRows, sep()] : []),
      ...preferenceRows,
      accountRow,
      sep(),
      menuLabel("Go to"),
      ...sectionRows,
    ],
  });
  menu.hidden = true;

  let overlay: { release: (restore?: boolean) => void } | null = null;
  const items = (): HTMLElement[] => focusableIn(menu);
  function closeMenu(restore = true): void {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    overlay?.release(restore);
    overlay = null;
  }
  function openMenu(): void {
    if (!menu.hidden) return;
    accountRow.querySelector(".shell-menu-label")!.textContent = ctx.signedIn() ? "Account" : "Sign in";
    menu.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    overlay = trapOverlay({ surface: menu, onDismiss: () => closeMenu(), ignore: [menuButton] });
  }
  menuButton.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()), { signal });
  menu.addEventListener("keydown", (event) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number): void => { event.preventDefault(); list[(next + list.length) % list.length]?.focus(); };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
  }, { signal });

  const element = el("header", {
    className: `shell-gamebar is-${options.run}`,
    attrs: { "data-mode": options.gameMode },
    children: [
      el("div", { className: "shell-gamebar-start", children: [back, switcher] }),
      el("div", { className: "shell-gamebar-end", children: [pill, el("div", { className: "shell-menu-anchor", children: [menuButton, menu] })] }),
    ],
  });

  return {
    element,
    setClock,
    setBest,
    openMenu,
    destroy: () => {
      closeMenu(false);
      controller.abort();
    },
  };
}
