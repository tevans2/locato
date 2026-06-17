const DROPDOWN_MARGIN_PX = 12;
const DROPDOWN_GAP_PX = 8;
const DROPDOWN_MAX_WIDTH_PX = 380;
const DROPDOWN_MAX_HEIGHT_PX = 360;
const DROPDOWN_MIN_HEIGHT_PX = 120;
const MOBILE_DROPDOWN_BREAKPOINT_PX = 700;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function closeOtherDropdowns(current: HTMLDetailsElement): void {
  for (const dropdown of document.querySelectorAll<HTMLDetailsElement>(".category-dropdown[open]")) {
    if (dropdown !== current) dropdown.open = false;
  }
}

function closeMobileMenus(): void {
  for (const sheet of document.querySelectorAll<HTMLElement>(".mobile-nav-sheet:not([hidden])")) {
    sheet.hidden = true;
  }
  for (const trigger of document.querySelectorAll<HTMLElement>(".mobile-nav-trigger[aria-expanded='true']")) {
    trigger.setAttribute("aria-expanded", "false");
  }
}

export function closeDropdown(dropdown: HTMLElement): void {
  if (dropdown instanceof HTMLDetailsElement) dropdown.open = false;
}

export function enhanceDropdown(
  dropdown: HTMLDetailsElement,
  options: { readonly signal: AbortSignal; readonly closeOnSelect?: boolean },
): HTMLDetailsElement {
  const summary = dropdown.querySelector<HTMLElement>(".category-dropdown-summary");
  const menu = dropdown.querySelector<HTMLElement>(".category-dropdown-menu");
  let animationFrame = 0;

  function positionMenu(): void {
    animationFrame = 0;
    if (!dropdown.open || !summary || !menu) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (viewportWidth <= MOBILE_DROPDOWN_BREAKPOINT_PX) {
      menu.style.setProperty("--dropdown-left", `${DROPDOWN_MARGIN_PX}px`);
      menu.style.setProperty("--dropdown-top", "auto");
      menu.style.setProperty("--dropdown-width", `${Math.max(0, viewportWidth - DROPDOWN_MARGIN_PX * 2)}px`);
      menu.style.setProperty("--dropdown-max-height", `${Math.max(DROPDOWN_MIN_HEIGHT_PX, Math.min(520, viewportHeight * 0.72))}px`);
      dropdown.classList.remove("dropdown-opens-above");
      return;
    }

    const summaryRect = summary.getBoundingClientRect();
    const usableWidth = Math.max(0, viewportWidth - DROPDOWN_MARGIN_PX * 2);
    const isGameModeMenu = dropdown.classList.contains("game-mode-dropdown");
    const isActionMenu = dropdown.classList.contains("action-menu");
    const minWidth = isGameModeMenu ? 560 : isActionMenu ? 220 : 280;
    const maxWidth = isGameModeMenu ? 640 : isActionMenu ? 280 : DROPDOWN_MAX_WIDTH_PX;
    const width = Math.min(Math.max(summaryRect.width, minWidth), maxWidth, usableWidth);
    const left = clamp(summaryRect.right - width, DROPDOWN_MARGIN_PX, viewportWidth - width - DROPDOWN_MARGIN_PX);
    const spaceBelow = viewportHeight - summaryRect.bottom - DROPDOWN_GAP_PX - DROPDOWN_MARGIN_PX;
    const spaceAbove = summaryRect.top - DROPDOWN_GAP_PX - DROPDOWN_MARGIN_PX;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(DROPDOWN_MIN_HEIGHT_PX, Math.min(openAbove ? spaceAbove : spaceBelow, DROPDOWN_MAX_HEIGHT_PX));
    const contentHeight = Math.min(menu.scrollHeight, availableHeight);
    const top = openAbove
      ? Math.max(DROPDOWN_MARGIN_PX, summaryRect.top - DROPDOWN_GAP_PX - contentHeight)
      : Math.min(summaryRect.bottom + DROPDOWN_GAP_PX, viewportHeight - DROPDOWN_MARGIN_PX - availableHeight);

    menu.style.setProperty("--dropdown-left", `${Math.round(left)}px`);
    menu.style.setProperty("--dropdown-top", `${Math.round(top)}px`);
    menu.style.setProperty("--dropdown-width", `${Math.round(width)}px`);
    menu.style.setProperty("--dropdown-max-height", `${Math.round(availableHeight)}px`);
    dropdown.classList.toggle("dropdown-opens-above", openAbove);
  }

  function queuePosition(): void {
    if (!dropdown.open) return;
    if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(positionMenu);
  }

  function closeSoon(): void {
    window.setTimeout(() => {
      dropdown.open = false;
    }, 0);
  }

  dropdown.addEventListener(
    "toggle",
    () => {
      dropdown.classList.toggle("is-open", dropdown.open);
      if (!dropdown.open) return;
      closeMobileMenus();
      closeOtherDropdowns(dropdown);
      queuePosition();
    },
    { signal: options.signal },
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!dropdown.open) return;
      const target = asElement(event.target);
      if (target && dropdown.contains(target)) return;
      dropdown.open = false;
    },
    { signal: options.signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !dropdown.open) return;
      dropdown.open = false;
      summary?.focus();
    },
    { signal: options.signal },
  );

  window.addEventListener("resize", queuePosition, { signal: options.signal });
  window.addEventListener("scroll", queuePosition, { signal: options.signal, capture: true });

  if (options.closeOnSelect && menu) {
    menu.addEventListener(
      "click",
      (event) => {
        const target = asElement(event.target);
        if (target?.closest(".category-option")) closeSoon();
      },
      { signal: options.signal },
    );
  }

  return dropdown;
}
