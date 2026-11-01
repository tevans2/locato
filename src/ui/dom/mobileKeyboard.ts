const DESKTOP_TEXT_INPUT_QUERY = "(hover: hover) and (pointer: fine)";
const TOUCH_KEYBOARD_QUERY = "(hover: none), (pointer: coarse)";
const MOBILE_WIDTH_PX = 700;
const KEYBOARD_OFFSET_THRESHOLD_PX = 80;
const TOUCH_SCROLL_DISMISS_THRESHOLD_PX = 12;

export interface KeyboardMetrics {
  /** The keyboard (or other UI) covering the bottom of the layout viewport. */
  readonly keyboardHeight: number;
  /** How far up from the layout viewport's bottom the visible area ends: where a docked bar goes. */
  readonly bottomInset: number;
  /** Where the visible area starts inside the layout viewport (iOS pans it to reveal a focused field). */
  readonly top: number;
  /** The visible area's height. */
  readonly height: number;
}

/**
 * Where the visible area is while a phone keyboard is open. iOS doesn't shrink the layout viewport
 * for the keyboard; it pans the visual viewport inside it (offsetTop > 0) when the focused field
 * would be covered. `position: fixed` is laid out against the layout viewport, so anything pinned
 * to its top slides out of sight unless it's offset by `top`, and a bar docked `bottomInset` above
 * the bottom lands just above the keyboard either way.
 */
export function keyboardMetrics(innerHeight: number, viewport: Pick<VisualViewport, "height" | "offsetTop" | "scale">): KeyboardMetrics {
  // Pinch-zoomed: the visual viewport is a magnified window, not a keyboard; leave layout alone.
  if (viewport.scale > 1.05) return { keyboardHeight: 0, bottomInset: 0, top: 0, height: innerHeight };
  const top = Math.max(0, viewport.offsetTop);
  return {
    keyboardHeight: Math.max(0, innerHeight - viewport.height),
    bottomInset: Math.max(0, innerHeight - viewport.height - top),
    top,
    height: viewport.height,
  };
}

export function isKeyboardDismissScroll(startY: number | null, currentY: number): boolean {
  return startY !== null && Math.abs(currentY - startY) >= TOUCH_SCROLL_DISMISS_THRESHOLD_PX;
}

function isTargetInsideInput(target: EventTarget | null, input: HTMLInputElement): boolean {
  return target instanceof Node && input.contains(target);
}

function scrollContainerFor(root: HTMLElement): HTMLElement | null {
  for (let element: HTMLElement | null = root; element; element = element.parentElement) {
    const overflowY = getComputedStyle(element).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && element.scrollHeight > element.clientHeight) return element;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

function isVisibleElement(element: HTMLElement): boolean {
  return !element.hidden && element.offsetParent !== null;
}

function keyboardAnchorFor(root: HTMLElement): HTMLElement | null {
  const selectors = [".flag-card", ".mystery-map-shell", ".overland-map-shell", ".world-map-panel", ".world-globe-panel", ".streetview-stage", ".puzzle-board"] as const;
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element && isVisibleElement(element)) return element;
  }
  return null;
}

const ANCHOR_TOP_GAP_PX = 6;

/** Scroll the prompt (flag, map, Street View) to the top of what's actually visible. */
function alignBoardToViewportTop(root: HTMLElement): void {
  const scrollContainer = scrollContainerFor(root);
  const board = keyboardAnchorFor(root);
  if (!scrollContainer || !board) return;
  // A pinned board (map modes) is placed by CSS, not by scrolling.
  if (getComputedStyle(board).position === "fixed") return;

  const containerRect = scrollContainer.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  // Both rects are in layout-viewport coordinates; the visible area may start lower than the
  // container's top when iOS has panned the visual viewport to show the input.
  const visibleTop = Math.max(containerRect.top, window.visualViewport?.offsetTop ?? 0) + ANCHOR_TOP_GAP_PX;
  const delta = boardRect.top - visibleTop;
  if (Math.abs(delta) < 2) return;
  scrollContainer.scrollTo({ top: scrollContainer.scrollTop + delta, behavior: "auto" });
}


export function shouldAutoFocusTextInput(viewportWidth = window.innerWidth, finePointer = window.matchMedia(DESKTOP_TEXT_INPUT_QUERY).matches): boolean {
  return finePointer && viewportWidth > MOBILE_WIDTH_PX;
}

export function isTouchKeyboardViewport(viewportWidth = window.innerWidth, touchPointer = window.matchMedia(TOUCH_KEYBOARD_QUERY).matches): boolean {
  return viewportWidth <= MOBILE_WIDTH_PX || touchPointer;
}

/**
 * iPhone / iPad Safari (any iOS browser): the keyboard only opens from a tap, never from a
 * script's focus(). iPadOS reports itself as a Mac, so touch points tell them apart.
 */
export function isAppleTouchDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
}

/**
 * Bring a phone keyboard back for a field that kept focus while its keyboard went down (it was
 * read-only for a while). focus() on an already-focused field is a no-op, so blur first; browsers
 * that let scripts open the keyboard (Android) then show it. Not on iOS, where only a tap can, and a
 * scripted blur would just drop the field's selected state.
 */
export function reopenKeyboard(input: HTMLInputElement): void {
  if (document.activeElement === input && isTouchKeyboardViewport() && !isAppleTouchDevice()) input.blur();
  input.focus({ preventScroll: true });
}

export function dismissKeyboardIfTouchInput(input: HTMLInputElement): void {
  if (document.activeElement === input && isTouchKeyboardViewport()) input.blur();
}

export function bindKeyboardAwareInput(root: HTMLElement, input: HTMLInputElement, signal: AbortSignal): void {
  const visualViewport = window.visualViewport;
  const alignmentTimeouts = new Set<number>();
  let touchStartY: number | null = null;

  const updateKeyboardOffset = (): void => {
    const metrics = visualViewport && isTouchKeyboardViewport() ? keyboardMetrics(window.innerHeight, visualViewport) : null;
    const hasVirtualKeyboard = metrics !== null && metrics.keyboardHeight > KEYBOARD_OFFSET_THRESHOLD_PX;
    const typing = root.classList.contains("is-mobile-typing");
    root.classList.toggle("has-virtual-keyboard", hasVirtualKeyboard);
    if (hasVirtualKeyboard) root.style.setProperty("--keyboard-offset", `${Math.round(metrics.bottomInset)}px`);
    else root.style.removeProperty("--keyboard-offset");
    // The visible area, for pinned/docked typing layouts. Android Chrome resizes the layout
    // viewport instead of panning (no keyboard offset), so the height is set whenever typing.
    if (metrics && (typing || hasVirtualKeyboard)) {
      root.style.setProperty("--viewport-top", `${Math.round(metrics.top)}px`);
      root.style.setProperty("--viewport-height", `${Math.round(metrics.height)}px`);
    } else {
      root.style.removeProperty("--viewport-top");
      root.style.removeProperty("--viewport-height");
    }
  };

  const updateTypingState = (): void => {
    const isTyping = document.activeElement === input && isTouchKeyboardViewport();
    root.classList.toggle("is-mobile-typing", isTyping);
    scrollContainerFor(root)?.classList.toggle("is-mobile-typing-shell", isTyping);
    updateKeyboardOffset();
  };

  const alignKeyboardAnchor = (): void => {
    if (document.activeElement !== input || !isTouchKeyboardViewport()) return;
    alignBoardToViewportTop(root);
  };

  const scheduleKeyboardAnchorAlignment = (): void => {
    if (document.activeElement !== input || !isTouchKeyboardViewport()) return;
    requestAnimationFrame(() => {
      alignKeyboardAnchor();
      requestAnimationFrame(alignKeyboardAnchor);
    });
    // iOS keeps animating the keyboard (and scrolling the focused field into view) for up to
    // ~600ms, and can land after an early alignment; keep checking until it has settled.
    for (const delay of [80, 180, 360, 600, 900]) {
      const timeoutId = window.setTimeout(() => {
        alignmentTimeouts.delete(timeoutId);
        alignKeyboardAnchor();
      }, delay);
      alignmentTimeouts.add(timeoutId);
    }
  };

  // Tapping the field's own buttons (Guess / Add / hint, or one marked data-keeps-keyboard such as
  // a lesson's Check) mustn't move focus off the field. If it does, the keyboard drops and the
  // docked layout jumps back mid-tap, so the tap only closes the keyboard and iOS never delivers the
  // click. Cancelling the press's default keeps focus (the click still fires), so one tap submits,
  // just like the keyboard's return key.
  const keepFieldFocused = (event: Event): void => {
    if (document.activeElement !== input || !isTouchKeyboardViewport()) return;
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.disabled) return;
    if (input.form?.contains(button) || button.hasAttribute("data-keeps-keyboard")) event.preventDefault();
  };
  root.addEventListener("pointerdown", keepFieldFocused, { signal });
  root.addEventListener("mousedown", keepFieldFocused, { signal });

  root.addEventListener(
    "touchstart",
    (event) => {
      touchStartY = document.activeElement === input && isTouchKeyboardViewport() && !isTargetInsideInput(event.target, input) ? event.touches[0]?.clientY ?? null : null;
    },
    { passive: true, signal },
  );
  root.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!touch || !isKeyboardDismissScroll(touchStartY, touch.clientY)) return;
      const scrollDeltaY = touchStartY! - touch.clientY;
      touchStartY = null;
      input.blur();
      (scrollContainerFor(root) ?? window).scrollBy({ top: scrollDeltaY, behavior: "auto" });
    },
    { passive: true, signal },
  );

  input.addEventListener(
    "focus",
    () => {
      updateTypingState();
      scheduleKeyboardAnchorAlignment();
    },
    { signal },
  );
  input.addEventListener("blur", updateTypingState, { signal });
  window.addEventListener(
    "resize",
    () => {
      updateTypingState();
      scheduleKeyboardAnchorAlignment();
    },
    { signal },
  );
  visualViewport?.addEventListener(
    "resize",
    () => {
      updateTypingState();
      scheduleKeyboardAnchorAlignment();
    },
    { signal },
  );
  visualViewport?.addEventListener(
    "scroll",
    () => {
      updateKeyboardOffset();
      scheduleKeyboardAnchorAlignment();
    },
    { signal },
  );
  // The browser's own "scroll the focused field into view" moves the page container without a
  // touch (a finger scroll dismisses the keyboard first, above), so put the prompt back on top.
  // The container is looked up on focus: the screen isn't in the document yet when this binds.
  let containerFrame = 0;
  let containerWatch: AbortController | null = null;
  const watchScrollContainer = (): void => {
    containerWatch?.abort();
    containerWatch = null;
    const container = scrollContainerFor(root);
    if (!container || signal.aborted) return;
    containerWatch = new AbortController();
    container.addEventListener(
      "scroll",
      () => {
        if (containerFrame || document.activeElement !== input || !isTouchKeyboardViewport()) return;
        containerFrame = requestAnimationFrame(() => {
          containerFrame = 0;
          alignKeyboardAnchor();
        });
      },
      { passive: true, signal: containerWatch.signal },
    );
  };
  input.addEventListener("focus", watchScrollContainer, { signal });
  input.addEventListener("blur", () => { containerWatch?.abort(); containerWatch = null; }, { signal });
  signal.addEventListener("abort", () => {
    for (const timeoutId of alignmentTimeouts) window.clearTimeout(timeoutId);
    alignmentTimeouts.clear();
    root.classList.remove("is-mobile-typing", "has-virtual-keyboard");
    scrollContainerFor(root)?.classList.remove("is-mobile-typing-shell");
    root.style.removeProperty("--keyboard-offset");
    root.style.removeProperty("--viewport-top");
    root.style.removeProperty("--viewport-height");
    if (containerFrame) cancelAnimationFrame(containerFrame);
    containerWatch?.abort();
  }, { once: true });
}
