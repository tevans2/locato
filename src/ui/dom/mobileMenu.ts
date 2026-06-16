import { el } from "./createElement";

export interface MobileMenuSection {
  readonly title: string;
  readonly items: readonly HTMLElement[];
}

export interface MobileMenu {
  readonly button: HTMLButtonElement;
  readonly sheet: HTMLElement;
  readonly close: () => void;
}

export function createMobileMenu(title: string, sections: readonly MobileMenuSection[], signal: AbortSignal): MobileMenu {
  const button = el("button", {
    className: "ghost-action nav-action mobile-nav-trigger",
    attrs: { type: "button", "data-mobile-label": "Menu", "aria-label": "Menu", "aria-haspopup": "dialog", "aria-expanded": "false" },
  });
  const closeButton = el("button", { className: "mobile-nav-close", text: "×", attrs: { type: "button", "aria-label": "Close menu" } });
  const sheet = el("aside", {
    className: "mobile-nav-sheet",
    attrs: { hidden: "true", role: "dialog", "aria-label": title },
    children: [
      el("div", { className: "mobile-nav-sheet-header", children: [el("strong", { text: title }), closeButton] }),
      ...sections.map((section) => el("section", { className: "mobile-nav-section", children: [el("h2", { text: section.title }), ...section.items] })),
    ],
  });

  const close = (): void => {
    sheet.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  const open = (): void => {
    sheet.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };

  button.addEventListener("click", () => (sheet.hidden ? open() : close()), { signal });
  closeButton.addEventListener("click", close, { signal });
  sheet.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) close();
    },
    { signal },
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  }, { signal });

  return { button, sheet, close };
}
