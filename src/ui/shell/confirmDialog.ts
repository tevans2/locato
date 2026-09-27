import { el } from "../dom/createElement";
import { shellLayer, trapOverlay } from "./layer";
import type { ConfirmOptions } from "./types";
import "../../styles/shell.css";

let dialogCount = 0;

/**
 * An accessible replacement for `window.confirm`: a modal alertdialog with a focus trap.
 * Escape, the backdrop and the cancel button resolve `false`; the confirm button resolves
 * `true`. Focus starts on the safe (cancel) choice and returns to the opener afterwards.
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  dialogCount += 1;
  const id = `shell-confirm-${dialogCount}`;
  return new Promise<boolean>((resolve) => {
    const cancel = el("button", { className: "shell-btn shell-btn-quiet", text: options.cancelLabel ?? "Stay", attrs: { type: "button", "data-action": "cancel" } });
    const confirm = el("button", {
      className: `shell-btn ${options.tone === "danger" ? "shell-btn-danger" : "shell-btn-primary"}`,
      text: options.confirmLabel ?? "Leave",
      attrs: { type: "button", "data-action": "confirm" },
    });
    const surface = el("div", {
      className: "shell-dialog",
      attrs: {
        role: "alertdialog",
        "aria-modal": "true",
        "aria-describedby": `${id}-message`,
        ...(options.title ? { "aria-labelledby": `${id}-title` } : { "aria-label": "Confirm" }),
        tabindex: "-1",
      },
      children: [
        ...(options.title ? [el("h2", { className: "shell-dialog-title", text: options.title, attrs: { id: `${id}-title` } })] : []),
        el("p", { className: "shell-dialog-message", text: message, attrs: { id: `${id}-message` } }),
        el("div", { className: "shell-dialog-actions", children: [cancel, confirm] }),
      ],
    });
    const backdrop = el("div", { className: "shell-scrim shell-dialog-scrim", attrs: { "data-open": "true" }, children: [surface] });
    shellLayer().append(backdrop);

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      overlay.release();
      backdrop.remove();
      resolve(value);
    };
    const overlay = trapOverlay({ surface, onDismiss: () => finish(false), initialFocus: cancel });
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
  });
}
