import { el } from "../dom/createElement";
import { isSoundEnabled, playCorrect, setSoundEnabled, SOUND_CHANGE_EVENT } from "../dom/sfx";
import { currentTheme, LOCATO_THEME_EVENT, toggleTheme } from "../theme";
import { shellIcon } from "./icons";
import "../../styles/shell.css";

/**
 * The sound · theme · account cluster that shell headers carry on their right. App builds it
 * once (it owns the single account trigger) and hands it to screens as `ShellContext.controls`.
 */
export interface ShellControls {
  readonly element: HTMLElement;
  /** Put the shared account trigger back into the cluster (legacy screens borrow it). */
  readonly adoptAccount: () => void;
  readonly destroy: () => void;
}

function soundButton(signal: AbortSignal): HTMLButtonElement {
  const button = el("button", { className: "shell-icon-btn shell-sound-toggle", attrs: { type: "button" } });
  const sync = (): void => {
    const on = isSoundEnabled();
    button.replaceChildren(shellIcon(on ? "volume-2" : "volume-x", 18));
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", "Sound effects");
    button.title = on ? "Sound on" : "Sound off";
  };
  button.addEventListener("click", () => {
    setSoundEnabled(!isSoundEnabled());
    if (isSoundEnabled()) playCorrect();
  }, { signal });
  window.addEventListener(SOUND_CHANGE_EVENT, sync, { signal });
  sync();
  return button;
}

function themeButton(storage: Storage | undefined, signal: AbortSignal): HTMLButtonElement {
  const button = el("button", { className: "shell-icon-btn shell-theme-toggle", attrs: { type: "button" } });
  const sync = (): void => {
    const dark = currentTheme() === "dark";
    button.replaceChildren(shellIcon(dark ? "sun" : "moon", 18));
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", "Dark mode");
    button.title = dark ? "Switch to light mode" : "Switch to dark mode";
  };
  button.addEventListener("click", () => toggleTheme(storage), { signal });
  window.addEventListener(LOCATO_THEME_EVENT, sync, { signal });
  sync();
  return button;
}

export function createShellControls(options: { readonly storage?: Storage; readonly account?: HTMLElement }): ShellControls {
  const controller = new AbortController();
  const accountSlot = el("span", { className: "shell-account-slot" });
  const element = el("div", {
    className: "shell-controls",
    attrs: { role: "group", "aria-label": "Sound, theme and account" },
    children: [soundButton(controller.signal), themeButton(options.storage, controller.signal), accountSlot],
  });
  const adoptAccount = (): void => {
    if (options.account && options.account.parentElement !== accountSlot) accountSlot.append(options.account);
  };
  adoptAccount();
  return { element, adoptAccount, destroy: () => controller.abort() };
}

/**
 * Sound and theme as `menuitemcheckbox` rows for the GameBar ⋯ menu. They stay in sync with
 * every other toggle through the shared change events; listeners detach with `signal`.
 */
export function createPreferenceMenuItems(storage: Storage | undefined, signal: AbortSignal): HTMLButtonElement[] {
  const row = (iconName: () => Parameters<typeof shellIcon>[0], label: string, checked: () => boolean, toggle: () => void, eventName: string): HTMLButtonElement => {
    const state = el("span", { className: "shell-menu-switch", attrs: { "aria-hidden": "true" } });
    const iconSlot = el("span", { className: "shell-menu-icon" });
    const button = el("button", {
      className: "shell-menu-item",
      attrs: { type: "button", role: "menuitemcheckbox" },
      children: [iconSlot, el("span", { className: "shell-menu-label", text: label }), state],
    });
    const sync = (): void => {
      iconSlot.replaceChildren(shellIcon(iconName(), 18));
      button.setAttribute("aria-checked", String(checked()));
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation(); // toggles keep the menu open
      toggle();
      sync();
    }, { signal });
    window.addEventListener(eventName, sync, { signal });
    sync();
    return button;
  };
  return [
    row(() => (isSoundEnabled() ? "volume-2" : "volume-x"), "Sound effects", isSoundEnabled, () => {
      setSoundEnabled(!isSoundEnabled());
      if (isSoundEnabled()) playCorrect();
    }, SOUND_CHANGE_EVENT),
    row(() => (currentTheme() === "dark" ? "moon" : "sun"), "Dark mode", () => currentTheme() === "dark", () => void toggleTheme(storage), LOCATO_THEME_EVENT),
  ];
}
