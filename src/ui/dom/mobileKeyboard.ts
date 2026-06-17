const DESKTOP_TEXT_INPUT_QUERY = "(hover: hover) and (pointer: fine)";
const TOUCH_KEYBOARD_QUERY = "(hover: none), (pointer: coarse)";
const MOBILE_WIDTH_PX = 700;
const KEYBOARD_OFFSET_THRESHOLD_PX = 80;
const TOUCH_SCROLL_DISMISS_THRESHOLD_PX = 12;

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
  const selectors = [".flag-card", ".world-map-panel", ".world-globe-panel", ".puzzle-board"] as const;
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element && isVisibleElement(element)) return element;
  }
  return null;
}

function alignBoardToViewportTop(root: HTMLElement): void {
  const scrollContainer = scrollContainerFor(root);
  const board = keyboardAnchorFor(root);
  if (!scrollContainer || !board) return;

  const containerRect = scrollContainer.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  scrollContainer.scrollTo({ top: scrollContainer.scrollTop + boardRect.top - containerRect.top, behavior: "auto" });
}


export function shouldAutoFocusTextInput(viewportWidth = window.innerWidth, finePointer = window.matchMedia(DESKTOP_TEXT_INPUT_QUERY).matches): boolean {
  return finePointer && viewportWidth > MOBILE_WIDTH_PX;
}

export function isTouchKeyboardViewport(viewportWidth = window.innerWidth, touchPointer = window.matchMedia(TOUCH_KEYBOARD_QUERY).matches): boolean {
  return viewportWidth <= MOBILE_WIDTH_PX || touchPointer;
}

export function dismissKeyboardIfTouchInput(input: HTMLInputElement): void {
  if (document.activeElement === input && isTouchKeyboardViewport()) input.blur();
}

export function bindKeyboardAwareInput(root: HTMLElement, input: HTMLInputElement, signal: AbortSignal): void {
  const visualViewport = window.visualViewport;
  const alignmentTimeouts = new Set<number>();
  let touchStartY: number | null = null;

  const updateKeyboardOffset = (): void => {
    let keyboardOffset = 0;
    if (visualViewport && isTouchKeyboardViewport()) {
      keyboardOffset = Math.max(0, window.innerHeight - visualViewport.height);
    }

    const hasVirtualKeyboard = keyboardOffset > KEYBOARD_OFFSET_THRESHOLD_PX;
    root.classList.toggle("has-virtual-keyboard", hasVirtualKeyboard);
    if (hasVirtualKeyboard) root.style.setProperty("--keyboard-offset", `${Math.round(keyboardOffset)}px`);
    else root.style.removeProperty("--keyboard-offset");
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
    for (const delay of [80, 180, 360]) {
      const timeoutId = window.setTimeout(() => {
        alignmentTimeouts.delete(timeoutId);
        alignKeyboardAnchor();
      }, delay);
      alignmentTimeouts.add(timeoutId);
    }
  };

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
  visualViewport?.addEventListener("scroll", scheduleKeyboardAnchorAlignment, { signal });
  signal.addEventListener("abort", () => {
    for (const timeoutId of alignmentTimeouts) window.clearTimeout(timeoutId);
    alignmentTimeouts.clear();
    root.classList.remove("is-mobile-typing", "has-virtual-keyboard");
    scrollContainerFor(root)?.classList.remove("is-mobile-typing-shell");
    root.style.removeProperty("--keyboard-offset");
  }, { once: true });
}
