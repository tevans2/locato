const DROPDOWN_MARGIN_PX = 12;
const DROPDOWN_GAP_PX = 8;
const DROPDOWN_MAX_WIDTH_PX = 380;
const DROPDOWN_MAX_HEIGHT_PX = 360;
const DROPDOWN_MIN_HEIGHT_PX = 120;

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

    const summaryRect = summary.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const usableWidth = Math.max(0, viewportWidth - DROPDOWN_MARGIN_PX * 2);
    const width = Math.min(Math.max(summaryRect.width, 280), DROPDOWN_MAX_WIDTH_PX, usableWidth);
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
