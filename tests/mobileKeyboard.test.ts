import { describe, expect, it } from "vitest";
import { isKeyboardDismissScroll, isTouchKeyboardViewport, shouldAutoFocusTextInput } from "../src/ui/dom/mobileKeyboard";

describe("mobile keyboard helpers", () => {
  it("autofocuses text input only on wide fine-pointer viewports", () => {
    expect(shouldAutoFocusTextInput(701, true)).toBe(true);
    expect(shouldAutoFocusTextInput(700, true)).toBe(false);
    expect(shouldAutoFocusTextInput(1024, false)).toBe(false);
  });

  it("treats narrow or coarse-pointer viewports as touch-keyboard targets", () => {
    expect(isTouchKeyboardViewport(390, false)).toBe(true);
    expect(isTouchKeyboardViewport(1024, true)).toBe(true);
    expect(isTouchKeyboardViewport(1024, false)).toBe(false);
  });

  it("dismisses the keyboard when a focused mobile user starts scrolling", () => {
    expect(isKeyboardDismissScroll(null, 100)).toBe(false);
    expect(isKeyboardDismissScroll(100, 109)).toBe(false);
    expect(isKeyboardDismissScroll(100, 112)).toBe(true);
    expect(isKeyboardDismissScroll(100, 86)).toBe(true);
  });
});
