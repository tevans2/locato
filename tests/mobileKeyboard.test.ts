// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { bindKeyboardAwareInput, isAppleTouchDevice, isKeyboardDismissScroll, isTouchKeyboardViewport, keyboardMetrics, shouldAutoFocusTextInput } from "../src/ui/dom/mobileKeyboard";

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

  it("measures the visible area when iOS pans the page up to show the field", () => {
    // 844px layout viewport, 330px keyboard, page panned 120px up: the visible area is 120→634.
    expect(keyboardMetrics(844, { height: 514, offsetTop: 120, scale: 1 })).toEqual({ keyboardHeight: 330, bottomInset: 210, top: 120, height: 514 });
    // Not panned: the docked bar sits right on the keyboard.
    expect(keyboardMetrics(844, { height: 514, offsetTop: 0, scale: 1 })).toMatchObject({ bottomInset: 330, top: 0 });
    // Android resizing the layout viewport instead: no keyboard offset, the height is the whole view.
    expect(keyboardMetrics(514, { height: 514, offsetTop: 0, scale: 1 })).toEqual({ keyboardHeight: 0, bottomInset: 0, top: 0, height: 514 });
  });

  it("ignores pinch-zoom", () => {
    expect(keyboardMetrics(844, { height: 300, offsetTop: 200, scale: 2 })).toEqual({ keyboardHeight: 0, bottomInset: 0, top: 0, height: 844 });
  });
});

describe("tapping the field's own buttons while typing on a phone", () => {
  const abort = new AbortController();
  afterEach(() => { abort.abort(); document.body.replaceChildren(); });

  it("keeps focus in the field so one tap submits (the keyboard doesn't drop first)", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    document.body.innerHTML = `<section id="root"><form><input id="guess"><button type="submit">Guess</button></form>
      <button id="check" data-keeps-keyboard>Check</button><button id="other">Give up</button></section>`;
    const root = document.getElementById("root")!;
    const input = document.getElementById("guess") as HTMLInputElement;
    bindKeyboardAwareInput(root, input, abort.signal);
    input.focus();
    const press = (selector: string) => {
      const event = new Event("pointerdown", { bubbles: true, cancelable: true });
      root.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press("button[type=submit]")).toBe(true);
    expect(press("#check")).toBe(true);
    expect(press("#other")).toBe(false);
    input.blur();
    expect(press("button[type=submit]")).toBe(false);
  });
});

describe("isAppleTouchDevice", () => {
  it("spots iPhones and iPads (which report as Macs) but not Android or desktop Macs", () => {
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});
