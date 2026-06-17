import { gameModeOptions, getGameModeOption, type GameModeId } from "../../core/gameModes";
import { el } from "./createElement";
import { enhanceDropdown } from "./dropdown";

export interface GameModeDropdownOptions {
  readonly selectedMode: GameModeId;
  readonly signal: AbortSignal;
  readonly name?: string;
  readonly onChange: (mode: GameModeId) => void;
}

export interface GameModeDropdown {
  readonly element: HTMLElement;
  readonly selectedMode: () => GameModeId;
  readonly setSelectedMode: (mode: GameModeId) => void;
}

export function createGameModeDropdown(options: GameModeDropdownOptions): GameModeDropdown {
  let selectedMode = options.selectedMode;
  const selectedText = el("span", { className: "category-dropdown-selected" });
  const radioName = options.name ?? "game-mode";

  const modeControls = gameModeOptions.map((mode) => {
    const radio = el("input", { attrs: { type: "radio", name: radioName, value: mode.id } });
    radio.checked = mode.id === selectedMode;
    const label = el("label", {
      className: "category-option game-mode-option",
      attrs: { title: mode.description },
      children: [
        radio,
        el("span", {
          className: "game-mode-option-copy",
          children: [el("span", { className: "game-mode-option-label", text: mode.label }), el("span", { className: "game-mode-option-description", text: mode.description })],
        }),
      ],
    });

    return { mode, radio, label };
  });

  function setSelectedMode(mode: GameModeId): void {
    selectedMode = mode;
    const selected = getGameModeOption(selectedMode);
    selectedText.textContent = selected.label;
    for (const control of modeControls) control.radio.checked = control.mode.id === selectedMode;
  }

  for (const control of modeControls) {
    control.radio.addEventListener(
      "change",
      () => {
        if (!control.radio.checked) return;
        setSelectedMode(control.mode.id);
        options.onChange(control.mode.id);
      },
      { signal: options.signal },
    );
  }

  const menuChildren: HTMLElement[] = [];
  const groups = new Map<string, typeof modeControls>();
  for (const control of modeControls) {
    const controls = groups.get(control.mode.group) ?? [];
    controls.push(control);
    groups.set(control.mode.group, controls);
  }

  for (const [groupLabel, controls] of groups) {
    menuChildren.push(
      el("section", {
        className: "game-mode-group",
        children: [el("div", { className: "game-mode-group-label", text: groupLabel }), ...controls.map((control) => control.label)],
      }),
    );
  }

  const element = el("details", {
    className: "category-dropdown game-mode-dropdown",
    children: [
      el("summary", {
        className: "category-dropdown-summary",
        children: [
          el("span", { className: "category-row-label", text: "Game mode" }),
          el("span", { className: "game-mode-selected-copy", children: [selectedText] }),
        ],
      }),
      el("div", { className: "category-dropdown-menu", attrs: { role: "radiogroup", "aria-label": "Game modes" }, children: menuChildren }),
    ],
  });

  setSelectedMode(selectedMode);
  enhanceDropdown(element, { signal: options.signal, closeOnSelect: true });

  return { element, selectedMode: () => selectedMode, setSelectedMode };
}
