import { el } from "../dom/createElement";
import { shellIcon } from "./icons";
import "../../styles/shell.css";

/**
 * Class hooks for screens that keep their own skin (the Academy lesson). When `classNames`
 * is given, those classes REPLACE the shell's default ones, so FocusBar supplies structure
 * and behaviour only and the screen's CSS is the sole styling.
 */
export interface FocusBarClassNames {
  readonly root: string;
  readonly close: string;
  readonly title: string;
  readonly progressWrap: string;
  readonly progress: string;
  readonly progressFill: string;
}

export interface FocusBarOptions {
  /** ✕. Ask before discarding unsaved progress (see ShellContext.confirmLeave). */
  readonly onClose: () => void;
  /** Accessible name for ✕ saying where it goes, e.g. "Back to Academy". */
  readonly closeLabel: string;
  /** Optional small title beside ✕ (hidden on phones by default styling). */
  readonly title?: string;
  /** 0..1 for the built-in bar, or your own element (e.g. placement's step dots). Omit for none. */
  readonly progress?: number | HTMLElement;
  /** Accessible name of the built-in progress bar. Default "Progress". */
  readonly progressLabel?: string;
  /** Right-hand slot, e.g. a streak counter. */
  readonly trailing?: HTMLElement;
  readonly classNames?: FocusBarClassNames;
  /** Icon inside ✕ (default the shell's x). Screens with their own icon set pass theirs. */
  readonly closeIcon?: Element;
}

export interface FocusBarHandle {
  readonly element: HTMLElement;
  /** The ✕ button. */
  readonly close: HTMLButtonElement;
  /** Wrapper that holds the progress bar and the trailing slot. */
  readonly progressWrap: HTMLElement;
  /** Update the built-in bar: fraction 0..1 plus an optional spoken value ("3 of 10 steps"). */
  readonly setProgress: (fraction: number, valueText?: string) => void;
  /** Replace the progress content with a custom element (or null for none). */
  readonly setProgressElement: (node: HTMLElement | null) => void;
  readonly setTrailing: (node: HTMLElement | null) => void;
}

const DEFAULT_CLASSES: FocusBarClassNames = {
  root: "shell-focusbar",
  close: "shell-icon-btn shell-focusbar-close",
  title: "shell-focusbar-title",
  progressWrap: "shell-focusbar-progress",
  progress: "shell-progress",
  progressFill: "shell-progress-fill",
};

/** Layout 3 ("Focus screen") bar: ✕ · progress · (optional) trailing slot such as a streak. */
export function createFocusBar(options: FocusBarOptions): FocusBarHandle {
  const classes = options.classNames ?? DEFAULT_CLASSES;
  const close = el("button", {
    className: classes.close,
    attrs: { type: "button", "aria-label": options.closeLabel, title: options.closeLabel },
    children: [options.closeIcon ?? shellIcon("x", 20, 2.2)],
    on: { click: () => options.onClose() },
  });

  const fill = el("span", { className: classes.progressFill });
  const bar = el("div", {
    className: classes.progress,
    attrs: { role: "progressbar", "aria-label": options.progressLabel ?? "Progress", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" },
    children: [fill],
  });
  const progressWrap = el("div", { className: classes.progressWrap });
  let progressNode: HTMLElement | null = null;
  let trailingNode: HTMLElement | null = options.trailing ?? null;

  const render = (): void => {
    progressWrap.replaceChildren(...(progressNode ? [progressNode] : []), ...(trailingNode ? [trailingNode] : []));
  };
  const setProgress = (fraction: number, valueText?: string): void => {
    const percent = Math.max(0, Math.min(100, (Number.isFinite(fraction) ? fraction : 0) * 100));
    fill.style.width = `${percent.toFixed(2)}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(percent)));
    if (valueText) bar.setAttribute("aria-valuetext", valueText);
    else bar.removeAttribute("aria-valuetext");
    fill.classList.toggle("is-started", percent > 0);
    if (progressNode !== bar) {
      progressNode = bar;
      render();
    }
  };
  const setProgressElement = (node: HTMLElement | null): void => {
    progressNode = node;
    render();
  };
  const setTrailing = (node: HTMLElement | null): void => {
    trailingNode = node;
    render();
  };

  if (typeof options.progress === "number") setProgress(options.progress);
  else if (options.progress) setProgressElement(options.progress);
  else render();

  const element = el("header", {
    className: classes.root,
    children: [close, ...(options.title ? [el("p", { className: classes.title, text: options.title })] : []), progressWrap],
  });
  return { element, close, progressWrap, setProgress, setProgressElement, setTrailing };
}
