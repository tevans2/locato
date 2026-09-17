import { flagPoolOptions, type FlagPool } from "../../core/flagPools";
import { el } from "./createElement";

export interface FlagPoolSelector {
  readonly element: HTMLElement;
  readonly value: () => FlagPool;
  readonly setValue: (flagPool: FlagPool) => void;
  readonly setDisabled: (disabled: boolean) => void;
}

export function createFlagPoolSelector(options: {
  readonly value: FlagPool;
  readonly signal: AbortSignal;
  readonly onChange: (flagPool: FlagPool) => void;
  readonly label?: string;
}): FlagPoolSelector {
  let value = options.value;
  let disabled = false;

  const buttons = flagPoolOptions.map((flagPoolOption) => {
    const button = el("button", {
      className: "flag-pool-option",
      text: flagPoolOption.shortLabel,
      attrs: {
        type: "button",
        "aria-label": flagPoolOption.label,
        title: flagPoolOption.label,
      },
    });
    return { flagPoolOption, button };
  });

  const element = el("div", {
    className: "flag-pool-control",
    children: [
      el("span", { className: "flag-pool-label", text: options.label ?? "Flag set" }),
      el("div", {
        className: "flag-pool-toggle",
        attrs: { role: "group", "aria-label": "Choose flags to include" },
        children: buttons.map(({ button }) => button),
      }),
    ],
  });

  function render(): void {
    for (const { flagPoolOption, button } of buttons) {
      const active = flagPoolOption.id === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = disabled;
    }
    element.classList.toggle("is-disabled", disabled);
  }

  for (const { flagPoolOption, button } of buttons) {
    button.addEventListener(
      "click",
      () => {
        if (disabled || flagPoolOption.id === value) return;
        value = flagPoolOption.id;
        render();
        options.onChange(value);
      },
      { signal: options.signal },
    );
  }

  render();
  return {
    element,
    value: () => value,
    setValue: (nextValue) => {
      value = nextValue;
      render();
    },
    setDisabled: (nextDisabled) => {
      disabled = nextDisabled;
      render();
    },
  };
}
