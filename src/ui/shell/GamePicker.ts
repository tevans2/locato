import { GAME_MODE_GROUPS, type GameModeCatalogueEntry, type GameModeId } from "../../core/gameModes";
import { el } from "../dom/createElement";
import { shellIcon } from "./icons";
import { shellLayer, trapOverlay } from "./layer";
import type { RunType } from "./types";
import "../../styles/shell.css";

export interface GamePickerOptions {
  /** The mode on screen now; it is marked "Playing". */
  readonly current?: GameModeId;
  /** The run type on screen now (marks which of Practice / Timed is current). */
  readonly currentRun?: RunType;
  /** Called with the chosen mode and run type. The picker closes itself first. */
  readonly onPick: (mode: GameModeId, run: RunType) => void;
  /** Heading; default "Choose a game". */
  readonly title?: string;
  /** Called after the sheet has closed for any reason (pick, ✕, Escape, backdrop). */
  readonly onClose?: () => void;
}

export interface GamePickerHandle {
  readonly element: HTMLElement;
  readonly close: () => void;
}

function modeRow(mode: GameModeCatalogueEntry, options: GamePickerOptions, pick: (mode: GameModeId, run: RunType) => void): HTMLElement {
  const isCurrent = mode.id === options.current;
  const practice = el("button", {
    className: "shell-picker-main",
    attrs: { type: "button", "data-mode": mode.id, "data-run": "practice", "aria-label": `${mode.label} — practice${isCurrent ? " (playing now)" : ""}` },
    children: [
      el("span", { className: "shell-picker-icon", children: [shellIcon(mode.icon, 20, 1.6)] }),
      el("span", {
        className: "shell-picker-copy",
        children: [
          el("span", {
            className: "shell-picker-name",
            children: [document.createTextNode(mode.label), ...(isCurrent ? [el("span", { className: "shell-picker-now", text: "Playing" })] : [])],
          }),
          el("span", { className: "shell-picker-blurb", text: mode.blurb }),
        ],
      }),
    ],
    on: { click: () => pick(mode.id, "practice") },
  });
  const children: HTMLElement[] = [practice];
  if (mode.leaderboard) {
    children.push(
      el("button", {
        className: `shell-picker-timed${isCurrent && options.currentRun === "timed" ? " is-current" : ""}`,
        attrs: { type: "button", "data-mode": mode.id, "data-run": "timed", "aria-label": `${mode.label} — timed run`, title: "Timed run · posts to the leaderboard" },
        children: [shellIcon("timer", 15, 2), el("span", { text: "Timed" })],
        on: { click: () => pick(mode.id, "timed") },
      }),
    );
  }
  return el("li", { className: `shell-picker-row${isCurrent ? " is-current" : ""}`, children });
}

/** The picker body on its own (for embedding in a page, e.g. a results screen). */
export function createGamePickerContent(options: GamePickerOptions, pick: (mode: GameModeId, run: RunType) => void = options.onPick): HTMLElement {
  return el("div", {
    className: "shell-picker-groups",
    children: GAME_MODE_GROUPS.map((group) =>
      el("section", {
        className: `shell-picker-group is-${group.id}`,
        attrs: { "aria-labelledby": `shell-picker-${group.id}` },
        children: [
          el("header", {
            className: "shell-picker-group-head",
            children: [
              el("h3", { text: group.label, attrs: { id: `shell-picker-${group.id}` } }),
              el("span", { text: group.tagline }),
            ],
          }),
          el("ul", { className: "shell-picker-list", children: group.modes.map((mode) => modeRow(mode, options, pick)) }),
        ],
      }),
    ),
  });
}

/**
 * The game picker sheet: every mode grouped Clues / Map / Street View, each with Practice
 * and (for leaderboard modes) Timed. A centred dialog on desktop, a bottom sheet on phones.
 */
export function openGamePicker(options: GamePickerOptions): GamePickerHandle {
  const titleId = "shell-picker-title";
  const close = el("button", { className: "shell-icon-btn shell-sheet-close", attrs: { type: "button", "aria-label": "Close" }, children: [shellIcon("x", 18, 2)] });
  let closed = false;
  let overlay: { release: (restore?: boolean) => void } | null = null;

  const finish = (after?: () => void): void => {
    if (closed) return;
    closed = true;
    overlay?.release(!after);
    scrim.remove();
    after?.();
    options.onClose?.();
  };
  const pick = (mode: GameModeId, run: RunType): void => finish(() => options.onPick(mode, run));

  const surface = el("div", {
    className: "shell-sheet shell-picker",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    children: [
      el("header", {
        className: "shell-sheet-head",
        children: [
          el("div", {
            children: [
              el("h2", { className: "shell-sheet-title", text: options.title ?? "Choose a game", attrs: { id: titleId } }),
              el("p", { className: "shell-sheet-sub", text: "Practice at your own pace, or go timed to post to the leaderboards." }),
            ],
          }),
          close,
        ],
      }),
      el("div", { className: "shell-sheet-body", children: [createGamePickerContent(options, pick)] }),
    ],
  });
  const scrim = el("div", { className: "shell-scrim", attrs: { "data-open": "true" }, children: [surface] });
  shellLayer().append(scrim);
  close.addEventListener("click", () => finish());
  const currentButton = options.current ? surface.querySelector<HTMLElement>(`.shell-picker-main[data-mode="${options.current}"]`) : null;
  overlay = trapOverlay({ surface, onDismiss: () => finish(), initialFocus: currentButton ?? close });
  return { element: surface, close: () => finish() };
}
