import { el } from "./createElement";

export interface ConfirmDialogOptions {
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

const STYLE_ID = "locato-confirm-dialog-style";

// Temporary self-contained styles; the shell's confirmDialog will replace this helper.
const STYLES = `
.confirm-dialog-backdrop { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px; background: rgba(12, 18, 14, 0.48); }
.confirm-dialog { width: min(420px, 100%); padding: 22px; border-radius: var(--radius-lg, 16px); border: 1px solid var(--border-strong, rgba(25,35,31,.3)); background: var(--surface, #fffef9); color: var(--text, #253e30); box-shadow: var(--shadow, 0 24px 64px rgba(0,0,0,.2)); font-family: var(--font-sans, sans-serif); }
.confirm-dialog-message { margin: 0 0 18px; font-size: 1rem; line-height: 1.45; }
.confirm-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

/**
 * Accessible modal confirmation. Resolves true when confirmed, false on cancel, Escape or a
 * backdrop click. Focus moves into the dialog, is trapped there, and returns afterwards.
 */
export function confirmDialog(message: string, opts: ConfirmDialogOptions = {}): Promise<boolean> {
  ensureStyles();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const messageId = `confirm-dialog-message-${Math.random().toString(36).slice(2, 8)}`;
  const cancel = el("button", { className: "ghost-action confirm-dialog-cancel", text: opts.cancelLabel ?? "Cancel", attrs: { type: "button" } });
  const confirm = el("button", { className: "primary-action confirm-dialog-confirm", text: opts.confirmLabel ?? "Continue", attrs: { type: "button" } });
  const dialog = el("div", {
    className: "confirm-dialog",
    attrs: { role: "alertdialog", "aria-modal": "true", "aria-describedby": messageId, "aria-labelledby": messageId },
    children: [el("p", { className: "confirm-dialog-message", text: message, attrs: { id: messageId } }), el("div", { className: "confirm-dialog-actions", children: [cancel, confirm] })],
  });
  const backdrop = el("div", { className: "confirm-dialog-backdrop", children: [dialog] });

  return new Promise<boolean>((resolve) => {
    const controller = new AbortController();
    const finish = (result: boolean): void => {
      controller.abort();
      backdrop.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(result);
    };
    cancel.addEventListener("click", () => finish(false), { signal: controller.signal });
    confirm.addEventListener("click", () => finish(true), { signal: controller.signal });
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish(false); }, { signal: controller.signal });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          finish(false);
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          (document.activeElement === cancel ? confirm : cancel).focus();
        }
      },
      { signal: controller.signal, capture: true },
    );
    document.body.append(backdrop);
    // Cancel is the safe default for destructive confirmations.
    cancel.focus();
  });
}
