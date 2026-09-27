// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { confirmDialog } from "../src/ui/dom/confirm";

afterEach(() => document.body.replaceChildren());

describe("confirmDialog", () => {
  it("resolves true on confirm and removes the dialog", async () => {
    const answer = confirmDialog("Restart?", { confirmLabel: "Restart" });
    const dialog = document.querySelector(".confirm-dialog")!;
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Cancel");
    document.querySelector<HTMLButtonElement>(".confirm-dialog-confirm")!.click();
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector(".confirm-dialog")).toBeNull();
  });

  it("resolves false on Escape and returns focus", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const answer = confirmDialog("Leave?");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(answer).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
