import { buildRouteUrl, type AppRoute } from "../../app/router";
import { el } from "../dom/createElement";
import { shellIcon } from "./icons";
import { markShellScreen, SITE_SECTIONS, type ShellContext, type SiteSection } from "./types";
import "../../styles/shell.css";

/** Where each section link points, so links are real URLs (middle-click, copy link). */
export const SECTION_ROUTES: Readonly<Record<SiteSection, AppRoute>> = {
  play: { type: "landing" },
  daily: { type: "daily-challenge" },
  learn: { type: "academy" },
  multiplayer: { type: "multiplayer" },
  leaderboards: { type: "leaderboards" },
  you: { type: "stats" },
};

export function sectionHref(section: SiteSection): string {
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  return buildRouteUrl(SECTION_ROUTES[section], { pathname });
}

export interface ShellBackLink {
  /** Say where it goes: "Back to Academy", never a vague "Back". */
  readonly label: string;
  readonly onClick: () => void;
}

export interface SiteHeaderOptions {
  /** The section this page belongs to; its link gets `aria-current="page"`. */
  readonly section: SiteSection;
  /** Page title for the heading band (`handle.heading`). Rendered as the page's h1. */
  readonly title?: string;
  readonly subtitle?: string;
  readonly back?: ShellBackLink;
  /** A small related-page link beside the title, e.g. "Atlas" on the Academy hub (rendered with →). */
  readonly titleLink?: ShellBackLink;
  /**
   * Asked before the logo or a section link leaves the page; return the question to ask, or null
   * when it is safe to go. Default: the screen root's `data-leave-confirm` (multiplayer room, …).
   */
  readonly leaveGuard?: () => string | null;
  /** Runs once leaving is confirmed, right before navigating (e.g. drop out of a room). */
  readonly onLeave?: () => void;
}

/** Guard + hook applied to every navigation the header starts. */
type LeaveCheck = (origin: HTMLElement, go: () => void) => void;

function createLeaveCheck(ctx: ShellContext, options: Pick<SiteHeaderOptions, "leaveGuard" | "onLeave"> = {}): LeaveCheck {
  return (origin, go) => {
    const message = options.leaveGuard ? options.leaveGuard() : origin.closest<HTMLElement>("[data-leave-confirm]")?.dataset.leaveConfirm ?? null;
    const proceed = (): void => {
      options.onLeave?.();
      go();
    };
    if (!message) {
      proceed();
      return;
    }
    void ctx.confirmLeave(message, { confirmLabel: "Leave", cancelLabel: "Stay" }).then((leave) => {
      if (leave) proceed();
    });
  };
}

export interface SiteHeaderHandle {
  /** The sticky top bar (logo · sections · controls). On phones it also carries the fixed TabBar. */
  readonly element: HTMLElement;
  /** Title / subtitle / back band, or null when none were given. Place it at the top of the page content. */
  readonly heading: HTMLElement | null;
  readonly setSection: (section: SiteSection) => void;
  readonly destroy: () => void;
}

function isPlainClick(event: Event): boolean {
  const mouse = event as MouseEvent;
  return !(mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey || (typeof mouse.button === "number" && mouse.button > 0));
}

function sectionLink(ctx: ShellContext, section: (typeof SITE_SECTIONS)[number], className: string, withIcon: boolean, check: LeaveCheck): HTMLAnchorElement {
  const link = el("a", {
    className,
    attrs: { href: sectionHref(section.id), "data-section": section.id, ...(withIcon && section.tabLabel ? { "aria-label": section.label } : {}) },
    children: [
      ...(withIcon ? [el("span", { className: "shell-tab-icon", children: [shellIcon(section.icon, 22, 1.7)] })] : []),
      el("span", { className: withIcon ? "shell-tab-label" : "shell-nav-label", text: withIcon ? section.tabLabel ?? section.label : section.label }),
    ],
  });
  link.addEventListener("click", (event) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    check(link, () => ctx.openSection(section.id));
  });
  return link;
}

function markCurrent(links: readonly HTMLAnchorElement[], section: SiteSection): void {
  for (const link of links) {
    if (link.dataset.section === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

export interface TabBarHandle {
  readonly element: HTMLElement;
  readonly setSection: (section: SiteSection) => void;
}

/**
 * The phone navigation: six sections with icons, fixed to the bottom with safe-area padding.
 * Hidden above 700px. While one is on the page, App's root reserves room for it so content
 * is never covered (see `#app:has(.shell-tabbar)` in shell.css).
 */
export function createTabBar(ctx: ShellContext, section: SiteSection, guard: Pick<SiteHeaderOptions, "leaveGuard" | "onLeave"> = {}): TabBarHandle {
  const check = createLeaveCheck(ctx, guard);
  const links = SITE_SECTIONS.map((item) => sectionLink(ctx, item, "shell-tab", true, check));
  const element = el("nav", { className: "shell-tabbar", attrs: { "aria-label": "Sections" }, children: links });
  markCurrent(links, section);
  return { element, setSection: (next) => markCurrent(links, next) };
}

export function createBrandButton(ctx: ShellContext, guard: Pick<SiteHeaderOptions, "leaveGuard" | "onLeave"> = {}): HTMLButtonElement {
  const check = createLeaveCheck(ctx, guard);
  const button: HTMLButtonElement = el("button", {
    className: "shell-brand",
    attrs: { type: "button", "aria-label": "Locato home" },
    children: [
      el("img", { className: "shell-brand-logo", attrs: { src: "/logo.svg", alt: "", width: "28", height: "28" } }),
      el("span", { className: "shell-brand-name", children: [document.createTextNode("locato"), el("span", { className: "shell-brand-dot", text: "." })] }),
    ],
    on: { click: () => check(button, () => ctx.goHome()) },
  });
  return button;
}

export function createBackLink(back: ShellBackLink, className = "shell-back"): HTMLButtonElement {
  return el("button", {
    className,
    attrs: { type: "button" },
    children: [shellIcon("arrow-left", 16, 2), el("span", { text: back.label })],
    on: { click: () => back.onClick() },
  });
}

/**
 * Layout 1 ("Site page") header: logo (always Home) · the five sections · controls.
 * The shared controls cluster moves into this header when it is built.
 */
export function createSiteHeader(ctx: ShellContext, options: SiteHeaderOptions): SiteHeaderHandle {
  const guard = { ...(options.leaveGuard ? { leaveGuard: options.leaveGuard } : {}), ...(options.onLeave ? { onLeave: options.onLeave } : {}) };
  const check = createLeaveCheck(ctx, guard);
  const navLinks = SITE_SECTIONS.map((item) => sectionLink(ctx, item, "shell-nav-link", false, check));
  const tabBar = createTabBar(ctx, options.section, guard);
  const element = el("header", {
    className: "shell-site-header",
    children: [
      el("div", {
        className: "shell-site-bar",
        children: [
          createBrandButton(ctx, guard),
          el("nav", { className: "shell-site-nav", attrs: { "aria-label": "Sections" }, children: navLinks }),
          el("div", { className: "shell-site-end", children: [ctx.controls] }),
        ],
      }),
      tabBar.element,
    ],
  });

  let heading: HTMLElement | null = null;
  if (options.title || options.subtitle || options.back) {
    const title = options.title ? el("h1", { className: "shell-heading-title", text: options.title }) : null;
    const titleLink = options.titleLink
      ? el("button", {
          className: "shell-heading-link",
          attrs: { type: "button" },
          children: [el("span", { text: options.titleLink.label }), shellIcon("arrow-right", 15, 2)],
          on: { click: () => options.titleLink?.onClick() },
        })
      : null;
    heading = el("div", {
      className: "shell-heading",
      children: [
        ...(options.back ? [createBackLink(options.back)] : []),
        ...(title && titleLink ? [el("div", { className: "shell-heading-row", children: [title, titleLink] })] : title ? [title] : []),
        ...(options.subtitle ? [el("p", { className: "shell-heading-sub", text: options.subtitle })] : []),
      ],
    });
  }

  const setSection = (section: SiteSection): void => {
    element.dataset.section = section;
    markCurrent(navLinks, section);
    tabBar.setSection(section);
  };
  setSection(options.section);

  return {
    element,
    heading,
    setSection,
    destroy: () => {
      if (element.contains(ctx.controls)) ctx.controls.remove();
    },
  };
}

export interface SitePageOptions extends SiteHeaderOptions {
  /** Extra class on the page root, e.g. "leaderboards-page". */
  readonly className?: string;
  /** Optional id on the page root, handy for scoping page CSS above global button styles. */
  readonly id?: string;
  /** Page content, appended after the heading band. More can be appended to `main` later. */
  readonly content?: readonly Node[];
}

export interface SitePage {
  /** The screen root (`data-shell="site"`), a full-height scroll container. Mount this. */
  readonly element: HTMLElement;
  readonly header: SiteHeaderHandle;
  /** Centred content column (max 1180px). Append your content here. */
  readonly main: HTMLElement;
  readonly destroy: () => void;
}

/** The standard site page: sticky SiteHeader, heading band and a centred content column. */
export function createSitePage(ctx: ShellContext, options: SitePageOptions): SitePage {
  const header = createSiteHeader(ctx, options);
  const main = el("main", {
    className: "shell-page-main",
    attrs: { id: `${options.id ?? "shell"}-main`, tabindex: "-1" },
    children: [...(header.heading ? [header.heading] : []), ...(options.content ?? [])],
  });
  const element = markShellScreen(
    el("section", {
      className: `shell-page${options.className ? ` ${options.className}` : ""}`,
      attrs: { ...(options.id ? { id: options.id } : {}), "data-section": options.section },
      children: [header.element, main],
    }),
    "site",
  );
  return { element, header, main, destroy: () => header.destroy() };
}
