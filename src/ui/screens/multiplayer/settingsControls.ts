import { MAP_TAP_CATEGORIES, MAP_TAP_CATEGORY_OPTIONS, MAP_TAP_LOCATIONS, type MapTapCategory } from "../../../core/maptap";
import { el } from "../../dom/createElement";
import { shellIcon } from "../../shell";
import { QUIZ_MODE_OPTIONS, type QuizMode } from "./roomModes";

export interface ChipPicker<T> {
  readonly element: HTMLElement;
  readonly value: () => readonly T[];
  readonly setValue: (value: readonly T[]) => void;
}

interface ChipOption<T> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
  readonly group?: string;
}

/**
 * Toggle chips laid out in the card (no pop-up menu): tap to add or remove. At least one stays
 * on, so the last one can't be switched off.
 */
function createChipPicker<T extends string>(options: {
  readonly label: string;
  readonly choices: readonly ChipOption<T>[];
  readonly initial: readonly T[];
  readonly signal: AbortSignal;
  readonly onChange: (value: readonly T[]) => void;
}): ChipPicker<T> {
  let selected: readonly T[] = options.initial;
  const chips = options.choices.map((choice) => {
    const chip = el("button", {
      className: "mp-chip",
      attrs: { type: "button", "aria-pressed": "false", title: choice.description },
      children: [el("span", { className: "mp-chip-check", attrs: { "aria-hidden": "true" }, children: [shellIcon("check", 13, 3)] }), el("span", { text: choice.label })],
    });
    chip.addEventListener("click", () => {
      const on = selected.includes(choice.value);
      if (on && selected.length === 1) return;
      const next = options.choices.map((item) => item.value).filter((value) => (value === choice.value ? !on : selected.includes(value)));
      setValue(next);
      options.onChange(selected);
    }, { signal: options.signal });
    return { choice, chip };
  });

  const groups = new Map<string, HTMLElement[]>();
  for (const { choice, chip } of chips) {
    const key = choice.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), chip]);
  }
  const element = el("div", {
    className: "mp-chip-picker",
    attrs: { role: "group", "aria-label": options.label },
    children: [...groups].map(([group, groupChips]) =>
      el("div", {
        className: "mp-chip-group",
        children: [...(group ? [el("span", { className: "mp-chip-group-label", text: group })] : []), el("div", { className: "mp-chip-row", children: groupChips })],
      }),
    ),
  });

  function setValue(value: readonly T[]): void {
    selected = value.length > 0 ? value : [options.choices[0]!.value];
    for (const { choice, chip } of chips) {
      const on = selected.includes(choice.value);
      chip.setAttribute("aria-pressed", String(on));
      chip.classList.toggle("is-on", on);
      // The last one on can't be removed; say so rather than ignoring the tap silently.
      chip.title = on && selected.length === 1 ? `${choice.description} (keep at least one)` : choice.description;
    }
  }

  setValue(selected);
  return { element, value: () => selected, setValue };
}

const QUIZ_GROUP_LABELS: Record<string, string> = { "Prompt games": "Clues", "World map games": "Map" };

/** Which prompt modes a quiz room mixes. */
export function createQuizModeSelector(options: { readonly signal: AbortSignal; readonly onChange: (modes: readonly QuizMode[]) => void }): ChipPicker<QuizMode> {
  return createChipPicker({
    label: "Quiz modes",
    choices: QUIZ_MODE_OPTIONS.map((option) => ({ value: option.id, label: option.label, description: option.description, group: QUIZ_GROUP_LABELS[option.group] ?? option.group })),
    initial: ["flags"],
    signal: options.signal,
    onChange: options.onChange,
  });
}

/** Which kinds of place a MapTap room draws from. */
export function createMapTapCategorySelector(options: { readonly signal: AbortSignal; readonly onChange: (categories: readonly MapTapCategory[]) => void }): ChipPicker<MapTapCategory> {
  return createChipPicker({
    label: "MapTap places",
    choices: MAP_TAP_CATEGORY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      description: `${option.description} · ${MAP_TAP_LOCATIONS.filter((location) => location.category === option.value).length} places`,
    })),
    initial: MAP_TAP_CATEGORIES,
    signal: options.signal,
    onChange: options.onChange,
  });
}
