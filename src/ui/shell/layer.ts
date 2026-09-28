/**
 * Overlay plumbing shared by the shell's sheets, menus and dialogs: a body-level host that
 * survives screen swaps (App replaces #app's children on every navigation), a focus trap,
 * and Escape / outside-click handling. All overlay CSS is scoped under `#shell-layer`.
 */

export const SHELL_LAYER_ID = "shell-layer";

export function shellLayer(): HTMLElement {
  let layer = document.getElementById(SHELL_LAYER_ID);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = SHELL_LAYER_ID;
    document.body.append(layer);
  }
  return layer;
}

const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => !item.closest("[hidden]") && !item.hasAttribute("inert"));
}

export interface OverlayOptions {
  /** The element that holds focus while open; Tab wraps inside it. */
  readonly surface: HTMLElement;
  /** Called for Escape, a backdrop click, or `close()`. */
  readonly onDismiss: () => void;
  /** Focus this when opening (default: the first focusable in `surface`). */
  readonly initialFocus?: HTMLElement | null;
  /** Clicks outside `surface` dismiss (default true). */
  readonly dismissOnOutsideClick?: boolean;
  /** Elements whose clicks never count as "outside" (e.g. the button that opened a popover). */
  readonly ignore?: readonly HTMLElement[];
}

export interface OverlayHandle {
  /** Remove listeners and restore focus to whatever was focused before opening. */
  readonly release: (restoreFocus?: boolean) => void;
}

/** Trap focus in `surface`, wire Escape and outside clicks. Pair every call with `release()`. */
export function trapOverlay(options: OverlayOptions): OverlayHandle {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const controller = new AbortController();
  const { signal } = controller;

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        options.onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableIn(options.surface);
      if (!items.length) {
        event.preventDefault();
        options.surface.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!options.surface.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === options.surface)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal, capture: true },
  );

  if (options.dismissOnOutsideClick !== false) {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (options.surface.contains(target)) return;
        if (options.ignore?.some((item) => item.contains(target))) return;
        options.onDismiss();
      },
      { signal, capture: true },
    );
  }

  const focusTarget = options.initialFocus ?? focusableIn(options.surface)[0] ?? options.surface;
  focusTarget.focus({ preventScroll: true });

  return {
    release: (restoreFocus = true) => {
      controller.abort();
      if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
    },
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
