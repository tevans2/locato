import { el } from "./createElement";
import { enhanceDropdown } from "./dropdown";

export interface ActionMenuItem {
  readonly label: string;
  readonly description?: string;
  readonly onSelect: () => void;
}

export interface ActionMenuOptions {
  readonly label?: string;
  readonly items: readonly ActionMenuItem[];
  readonly signal: AbortSignal;
}

export function createActionMenu(options: ActionMenuOptions): HTMLElement {
  const menuItems = options.items.map((item) => {
    const button = el("button", {
      className: "category-option action-menu-option",
      attrs: { type: "button", role: "menuitem" },
      children: [
        el("span", {
          className: "action-menu-option-copy",
          children: [
            el("strong", { text: item.label }),
            ...(item.description ? [el("span", { text: item.description })] : []),
          ],
        }),
      ],
    });

    button.addEventListener("click", item.onSelect, { signal: options.signal });
    return button;
  });

  const element = el("details", {
    className: "category-dropdown action-menu",
    children: [
      el("summary", {
        className: "category-dropdown-summary action-menu-summary",
        children: [el("span", { className: "category-dropdown-selected", text: options.label ?? "Menu" })],
      }),
      el("div", {
        className: "category-dropdown-menu action-menu-panel",
        attrs: { role: "menu", "aria-label": options.label ?? "Menu" },
        children: menuItems,
      }),
    ],
  });

  enhanceDropdown(element, { signal: options.signal, closeOnSelect: true });
  return element;
}
