import { el } from "../dom/createElement";

/** The You section's sub-pages (docs/navigation.md → "You"): Stats · Friends · Achievements. */
export type YouTab = "stats" | "friends" | "achievements";

export const YOU_TABS: readonly { readonly id: YouTab; readonly label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "friends", label: "Friends" },
  { id: "achievements", label: "Achievements" },
];

export interface YouTabsHandle {
  readonly element: HTMLElement;
  readonly setCurrent: (tab: YouTab) => void;
}

/**
 * The sub-navigation under the You pages' title. Each item is a plain button marked with
 * `aria-current="page"` when shown (Friends is its own route; Stats and Achievements share one).
 */
export function createYouTabs(current: YouTab, onSelect: (tab: YouTab) => void): YouTabsHandle {
  const buttons = YOU_TABS.map((tab) =>
    el("button", {
      className: "you-tab",
      text: tab.label,
      attrs: { type: "button", "data-tab": tab.id },
      on: { click: () => onSelect(tab.id) },
    }),
  );
  const setCurrent = (tab: YouTab): void => {
    for (const button of buttons) {
      if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  };
  setCurrent(current);
  return { element: el("nav", { className: "you-tabs", attrs: { "aria-label": "You" }, children: buttons }), setCurrent };
}

/** Title band shared by the You pages (same look as the shell heading). */
export function createYouHeading(title: string, subtitle: string): { readonly element: HTMLElement; readonly setTitle: (title: string, subtitle: string) => void } {
  const h1 = el("h1", { className: "shell-heading-title", text: title });
  const sub = el("p", { className: "shell-heading-sub", text: subtitle });
  return {
    element: el("div", { className: "shell-heading you-heading", children: [h1, sub] }),
    setTitle: (nextTitle, nextSubtitle) => {
      h1.textContent = nextTitle;
      sub.textContent = nextSubtitle;
    },
  };
}
