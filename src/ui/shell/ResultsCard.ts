import { el } from "../dom/createElement";
import { shellIcon, type ShellIconName } from "./icons";
import type { ShellContext } from "./types";
import "../../styles/shell.css";

export interface ResultsStat {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface ResultsMissedCountry {
  /** ISO alpha-2; opens `?country=xx` through `ctx.openCountry`. */
  readonly code: string;
  readonly name: string;
  readonly flagSrc?: string;
}

export interface ResultsAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: ShellIconName;
}

export interface ResultsShare {
  /** The text to share, e.g. the daily's emoji grid. */
  readonly text: string;
  readonly title?: string;
  readonly url?: string;
}

export interface ResultsCardOptions {
  /** Small line above the title, e.g. "Flags · Practice" or "Timed run". */
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle?: string;
  /** One to four headline numbers. The first is the hero stat. */
  readonly stats: readonly ResultsStat[];
  /** Countries to revisit; each links to its Atlas page. Omit or pass [] when nothing was missed. */
  readonly missed?: readonly ResultsMissedCountry[];
  /** Heading for the missed list. Default "Worth another look". */
  readonly missedTitle?: string;
  /** "Play again". Focused when the card is shown. */
  readonly primary: ResultsAction;
  /** Extra secondary actions after "Try another game". */
  readonly secondary?: readonly ResultsAction[];
  /** Shows "Try another game" (opens the picker via ctx). Default true. */
  readonly tryAnother?: boolean;
  /** Adds Share: navigator.share when available, otherwise copies the text. */
  readonly share?: ResultsShare;
  /** The practice ↔ timed cross-link: "Try it timed →" / "Practise this mode". */
  readonly crossLink?: ResultsAction;
  /** "celebrate" adds the seal and a gentle entrance (none under reduced motion). Default "celebrate". */
  readonly tone?: "celebrate" | "neutral";
}

export interface ResultsCardHandle {
  readonly element: HTMLElement;
  /** Move focus to the heading so screen readers announce the result. */
  readonly focus: () => void;
}

/** Share `text` with the OS sheet, or copy it. Resolves with what happened. */
export async function shareResult(share: ResultsShare): Promise<"shared" | "copied" | "failed"> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const payload: ShareData = { text: share.text, ...(share.title ? { title: share.title } : {}), ...(share.url ? { url: share.url } : {}) };
  if (nav && typeof nav.share === "function" && (typeof nav.canShare !== "function" || nav.canShare(payload))) {
    try {
      await nav.share(payload);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "failed";
      // Fall through to the clipboard.
    }
  }
  try {
    await nav?.clipboard?.writeText(share.url ? `${share.text}\n${share.url}` : share.text);
    return nav?.clipboard ? "copied" : "failed";
  } catch {
    return "failed";
  }
}

function actionButton(action: ResultsAction, className: string, fallbackIcon?: ShellIconName): HTMLButtonElement {
  const iconName = action.icon ?? fallbackIcon;
  return el("button", {
    className,
    attrs: { type: "button" },
    children: [...(iconName ? [shellIcon(iconName, 17, 2)] : []), el("span", { text: action.label })],
    on: { click: () => action.onClick() },
  });
}

/**
 * The shared end-of-run card (docs/navigation.md: "Every run ends on a results screen"):
 * score/time, what you missed (each links to its Atlas page), Play again · Try another game ·
 * Share, plus the practice/timed cross-link. Screens place it in their own layout.
 */
export function createResultsCard(ctx: ShellContext, options: ResultsCardOptions): ResultsCardHandle {
  const tone = options.tone ?? "celebrate";
  const heading = el("h2", { className: "shell-results-title", text: options.title, attrs: { tabindex: "-1" } });

  const stats = el("dl", {
    className: `shell-results-stats is-${Math.min(options.stats.length, 4)}`,
    children: options.stats.map((stat, index) =>
      el("div", {
        className: `shell-results-stat${index === 0 ? " is-hero" : ""}`,
        attrs: { style: `--shell-i:${index}` },
        children: [
          el("dt", { text: stat.label }),
          el("dd", { children: [el("strong", { text: stat.value }), ...(stat.note ? [el("span", { text: stat.note })] : [])] }),
        ],
      }),
    ),
  });

  const sections: HTMLElement[] = [];
  if (options.missed?.length) {
    sections.push(
      el("section", {
        className: "shell-results-missed",
        attrs: { "aria-labelledby": "shell-results-missed-title" },
        children: [
          el("h3", { text: options.missedTitle ?? "Worth another look", attrs: { id: "shell-results-missed-title" } }),
          el("ul", {
            children: options.missed.map((country) =>
              el("li", {
                children: [
                  el("button", {
                    className: "shell-chip",
                    attrs: { type: "button", "data-country": country.code, "aria-label": `${country.name} in the Atlas` },
                    children: [
                      ...(country.flagSrc ? [el("img", { className: "shell-chip-flag", attrs: { src: country.flagSrc, alt: "", loading: "lazy", decoding: "async" } })] : []),
                      el("span", { text: country.name }),
                      shellIcon("arrow-right", 14, 2),
                    ],
                    on: { click: () => ctx.openCountry(country.code) },
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    );
  }

  const status = el("p", { className: "shell-results-status", attrs: { role: "status", "aria-live": "polite" } });
  const secondary: HTMLElement[] = [];
  if (options.tryAnother !== false) secondary.push(actionButton({ label: "Try another game", onClick: () => ctx.openGamePicker() }, "shell-btn shell-btn-quiet", "layout-grid"));
  for (const action of options.secondary ?? []) secondary.push(actionButton(action, "shell-btn shell-btn-quiet"));
  if (options.share) {
    const share = options.share;
    const button = actionButton({ label: "Share", onClick: () => undefined }, "shell-btn shell-btn-quiet shell-results-share", "share-2");
    button.addEventListener("click", async () => {
      const outcome = await shareResult(share);
      status.textContent = outcome === "copied" ? "Copied to your clipboard." : outcome === "failed" ? "" : "Thanks for sharing!";
    });
    secondary.push(button);
  }

  const primary = actionButton(options.primary, "shell-btn shell-btn-primary shell-results-primary", "rotate-ccw");
  const element = el("article", {
    className: `shell-results is-${tone}`,
    attrs: { "aria-labelledby": "shell-results-heading" },
    children: [
      ...(tone === "celebrate" ? [el("div", { className: "shell-results-seal", attrs: { "aria-hidden": "true" }, children: [shellIcon("check", 26, 2.6)] })] : []),
      ...(options.kicker ? [el("p", { className: "shell-results-kicker", text: options.kicker })] : []),
      heading,
      ...(options.subtitle ? [el("p", { className: "shell-results-sub", text: options.subtitle })] : []),
      stats,
      ...sections,
      el("div", {
        className: "shell-results-actions",
        children: [primary, el("div", { className: "shell-results-secondary", children: secondary })],
      }),
      ...(options.crossLink
        ? [el("button", {
            className: "shell-results-cross",
            attrs: { type: "button" },
            children: [el("span", { text: options.crossLink.label.replace(/\s*→\s*$/, "") }), shellIcon("arrow-right", 16, 2)],
            on: { click: () => options.crossLink!.onClick() },
          })]
        : []),
      status,
    ],
  });
  heading.id = "shell-results-heading";
  return { element, focus: () => heading.focus({ preventScroll: true }) };
}
