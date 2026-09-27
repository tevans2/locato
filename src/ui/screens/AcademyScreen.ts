import type { Screen } from "../../app/router";
import type { ShellContext } from "../shell/types";
import type { AcademyProgressStore } from "../../app/academyProgress";
import {
  ACADEMY_COUNTRY_CODES,
  academyLevel,
  continentSummary,
  dueCount,
  findGroup,
  groupCompletion,
  groupForCountry,
  LEARNING_GROUPS,
  skipPlacement,
  studyStreak,
  resumeGroup,
  suggestNextGroup,
  toDayKey,
  type AcademyProgress,
} from "../../core/academy";
import type { Continent, CountryCode, CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { el } from "../dom/createElement";
import { createSiteHeader, markShellScreen, type SiteHeaderHandle } from "../shell";
import { createMasteryMap } from "../components/academy/MasteryMap";
import { flagStrip, groupCard } from "../components/academy/hubCards";
import { groupPanel } from "../components/academy/hubGroupPanel";
import { hubIcon } from "../components/academy/hubIcons";
import "../../styles/academy.css";

export interface AcademyScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Group whose detail panel is open (mirrored in the URL). */
  readonly initialGroupId?: string;
  readonly onHome: () => void;
  readonly onBack: () => void;
  /** Group id, "review", or "lookalikes:<CODE>". */
  readonly onStartLesson: (lessonId: string) => void;
  readonly onStartPlacement: () => void;
  readonly onOpenCountry: (code: string) => void;
  /** The heading's "Atlas →" link (the index of every country). */
  readonly onOpenAtlas?: () => void;
  /** Called when the open group changes so the URL can follow (replaces, not pushes). */
  readonly onGroupChange: (groupId: string | null) => void;
  /** Clock override for tests. */
  readonly now?: () => number;
}

/** Continents in the order the trail first visits them. */
const TRAIL_CONTINENTS: readonly Continent[] = [...new Set(LEARNING_GROUPS.map((group) => group.continent))];

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function createAcademyScreen(options: AcademyScreenOptions): Screen {
  const { countryIndex, progressStore } = options;
  const now = options.now ?? Date.now;
  const totalCountries = ACADEMY_COUNTRY_CODES.length;

  let openGroupId: string | null = null;
  let pickedCode: CountryCode | null = null;
  let continentFilter: Continent | null = null;

  // ---------- Map ----------
  const map = createMasteryMap({
    features: options.worldCountryFeatures,
    countryIndex,
    onSelectCountry: (code) => selectCountry(code, map.element),
  });

  // ---------- Header ----------
  // Shared SiteHeader (Learn) + the page title with a small link to the Atlas.
  const siteHeader: SiteHeaderHandle | null = options.shell ? createSiteHeader(options.shell, { section: "learn" }) : null;
  const header = el("header", {
    className: "academy-header",
    children: [
      el("div", {
        className: "academy-header-title",
        children: [el("h1", { text: "Academy" }), el("p", { text: "Learn the world one region at a time" })],
      }),
      ...(options.onOpenAtlas
        ? [
            el("button", {
              className: "academy-atlas-link",
              attrs: { type: "button" },
              children: [el("span", { text: "Atlas" }), hubIcon("arrow")],
              on: { click: () => options.onOpenAtlas?.() },
            }),
          ]
        : []),
    ],
  });

  // ---------- Map toolbar: continent chips + country finder ----------
  // Continent tiles double as zoom controls and a progress overview.
  const chips = el("div", { className: "academy-chips", attrs: { role: "group", "aria-label": "Zoom the map to a continent" } });
  function renderChips(progress: AcademyProgress): void {
    const tiles = ([null, ...TRAIL_CONTINENTS] as (Continent | null)[]).map((continent) => {
      const summaries = (continent ? [continent] : TRAIL_CONTINENTS).map((key) => continentSummary(progress, key));
      const cleared = summaries.reduce((sum, item) => sum + item.completedGroups, 0);
      const stops = summaries.reduce((sum, item) => sum + item.groupCount, 0);
      const countries = summaries.reduce((sum, item) => sum + item.total, 0);
      const weighted = summaries.reduce((sum, item) => sum + item.percent * item.total, 0);
      const percent = countries === 0 ? 0 : Math.round(weighted / countries);
      return el("button", {
        className: "academy-chip",
        attrs: {
          type: "button",
          "aria-pressed": String(continent === continentFilter),
          "aria-label": `${continent ?? "Whole world"}: ${cleared} of ${stops} stops cleared, ${percent}%`,
        },
        children: [
          el("span", { className: "academy-chip-name", text: continent ?? "World" }),
          el("span", { className: "academy-chip-meta", text: `${cleared}/${stops} stops` }),
          el("span", { className: "academy-chip-bar", children: [el("span", { attrs: { style: `--fill: ${(percent / 100).toFixed(3)}` } })] }),
        ],
        on: { click: () => setContinent(continent) },
      });
    });
    chips.replaceChildren(...tiles);
  }

  const datalistId = "academy-country-options";
  const namesToCodes = new Map<string, CountryCode>();
  const datalist = el("datalist", {
    attrs: { id: datalistId },
    children: ACADEMY_COUNTRY_CODES.map((code) => countryIndex.byCode.get(code))
      .filter((country) => country !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((country) => {
        namesToCodes.set(country.name.toLowerCase(), country.code);
        return el("option", { attrs: { value: country.name } });
      }),
  });
  const searchInput = el("input", {
    className: "academy-search-input",
    attrs: { type: "search", list: datalistId, placeholder: "Find a country", "aria-label": "Find a country on the map", autocomplete: "off", spellcheck: "false" },
  });
  function trySearch(): boolean {
    const code = namesToCodes.get(searchInput.value.trim().toLowerCase());
    if (!code) return false;
    searchInput.value = "";
    searchInput.blur();
    selectCountry(code, searchInput);
    return true;
  }
  searchInput.addEventListener("change", () => void trySearch());
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && trySearch()) event.preventDefault();
  });
  const search = el("label", { className: "academy-search", children: [hubIcon("search"), searchInput, datalist] });

  const mapStage = el("div", {
    className: "academy-map-stage",
    children: [
      el("div", {
        className: "academy-map-toolbar",
        children: [el("h2", { className: "academy-map-title", children: [document.createTextNode("Your atlas"), el("span", { text: "Shaded by what you know" })] }), search],
      }),
      map.element,
      chips,
    ],
  });

  // ---------- Side column (summary + group panel) ----------
  const summaryHost = el("div", { className: "academy-summary" });
  const panelHost = el("div", { className: "academy-panel-host" });
  const side = el("aside", { className: "academy-side", attrs: { "aria-label": "Your progress" }, children: [summaryHost, panelHost] });
  const hero = el("div", { className: "academy-hero", children: [mapStage, side] });

  // ---------- Trail ----------
  const trailHost = el("div", { className: "academy-trail-body" });
  const trail = el("section", {
    className: "academy-trail",
    attrs: { "aria-labelledby": "academy-trail-title" },
    children: [
      el("div", {
        className: "academy-trail-head",
        children: [
          el("p", { className: "academy-kicker", text: "The learning trail" }),
          el("h2", { attrs: { id: "academy-trail-title" }, text: `${LEARNING_GROUPS.length} stops around the world` }),
          el("p", { className: "academy-trail-lede", text: "Each stop is a handful of neighbours. Clear a stop by getting every country to familiar, then keep reviewing to master them." }),
        ],
      }),
      trailHost,
    ],
  });

  const element = el("section", {
    className: "academy-screen",
    // The id scopes academy.css above the app-wide button/input styles.
    attrs: { id: "academy", "aria-label": "Academy" },
    children: [...(siteHeader ? [siteHeader.element] : []), el("div", { className: "academy-body", children: [header, el("main", { className: "academy-main", children: [hero, trail] })] })],
  });
  if (siteHeader) markShellScreen(element, "site");

  // ---------- Rendering ----------
  function rankCard(progress: AcademyProgress): HTMLElement {
    const status = academyLevel(progress);
    const streak = studyStreak(progress.activity, toDayKey(now()));
    const toNext = status.next ? status.next.minMastered - status.mastered : 0;
    const percent = Math.round(status.progressToNext * 100);
    return el("section", {
      className: "academy-rank",
      attrs: { "aria-label": "Your rank" },
      children: [
        el("div", {
          className: "academy-rank-top",
          children: [
            el("span", { className: "academy-rank-emblem", attrs: { "data-level": String(status.level.index) }, children: [hubIcon("compass")] }),
            el("div", {
              className: "academy-rank-name",
              children: [
                el("p", { className: "academy-kicker", text: `Rank ${status.level.index + 1}` }),
                el("strong", { className: "academy-rank-title", text: status.level.title }),
              ],
            }),
          ],
        }),
        el("div", {
          className: "academy-rank-bar",
          attrs: {
            role: "progressbar",
            "aria-label": status.next ? `Progress to ${status.next.title}` : "Top rank reached",
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(percent),
          },
          children: [el("span", { attrs: { style: `--fill: ${status.progressToNext.toFixed(3)}` } })],
        }),
        el("p", {
          className: "academy-rank-next",
          text: status.next ? `${plural(toNext, "more country", "more countries")} mastered to reach ${status.next.title}` : "Top rank. The whole atlas is yours.",
        }),
        el("dl", {
          className: "academy-stats",
          children: [
            el("div", {
              className: `academy-stat${streak > 0 ? " is-lit" : ""}`,
              children: [hubIcon("flame"), el("dt", { text: "Day streak" }), el("dd", { text: String(streak) })],
            }),
            el("div", {
              className: "academy-stat",
              children: [hubIcon("seal"), el("dt", { text: "Mastered" }), el("dd", { children: [document.createTextNode(String(status.mastered)), el("small", { text: ` / ${totalCountries}` })] })],
            }),
          ],
        }),
      ],
    });
  }

  function reviewButton(progress: AcademyProgress): HTMLElement | null {
    const due = dueCount(progress, now());
    if (due <= 0) return null;
    return el("button", {
      className: "academy-review-button",
      attrs: { type: "button", "aria-label": `Review due: ${plural(due, "card")}` },
      children: [
        hubIcon("review"),
        el("span", { className: "academy-review-text", children: [el("strong", { text: "Review due" }), el("span", { text: `${plural(due, "card")} ready to refresh` })] }),
        el("span", { className: "academy-review-count", attrs: { "aria-hidden": "true" }, text: String(due) }),
      ],
      on: { click: () => options.onStartLesson("review") },
    });
  }

  function welcomeCard(): HTMLElement {
    return el("section", {
      className: "academy-welcome",
      attrs: { "aria-labelledby": "academy-welcome-title" },
      children: [
        el("p", { className: "academy-kicker", text: "Welcome, traveller" }),
        el("h2", { attrs: { id: "academy-welcome-title" }, text: "Every expert started as a tourist." }),
        el("p", { text: "Take a quick 20-question placement and we'll tick off what you already know, so you start exactly at your level." }),
        el("div", {
          className: "academy-welcome-actions",
          children: [
            el("button", {
              className: "academy-button academy-button-primary academy-find-level",
              attrs: { type: "button" },
              children: [el("span", { text: "Find your level" }), hubIcon("arrow")],
              on: { click: () => options.onStartPlacement() },
            }),
            el("button", {
              className: "academy-button academy-button-quiet academy-from-scratch",
              attrs: { type: "button" },
              text: "Start from scratch",
              on: { click: startFromScratch },
            }),
          ],
        }),
      ],
    });
  }

  function continueCard(progress: AcademyProgress): HTMLElement {
    const resume = resumeGroup(progress);
    const next = resume ?? suggestNextGroup(progress);
    if (!next) {
      return el("section", {
        className: "academy-continue is-done",
        children: [
          el("p", { className: "academy-kicker", text: "Grand tour complete" }),
          el("h2", { text: "Every stop cleared." }),
          el("p", { className: "academy-continue-blurb", text: "Keep your reviews going to turn familiar countries into mastered ones." }),
        ],
      });
    }
    const summary = groupCompletion(progress, next);
    return el("section", {
      className: "academy-continue",
      attrs: { "aria-labelledby": "academy-continue-title" },
      children: [
        el("p", { className: "academy-kicker", text: resume ? "Pick up where you left off" : `Up next · Stop ${next.order + 1}` }),
        el("h2", { attrs: { id: "academy-continue-title" }, text: next.title }),
        el("p", { className: "academy-continue-blurb", text: next.blurb }),
        flagStrip(next.countryCodes, countryIndex),
        el("div", {
          className: "academy-continue-bar",
          attrs: { role: "progressbar", "aria-label": `${next.title} progress`, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(summary.percent) },
          children: [el("span", { attrs: { style: `--fill: ${(summary.percent / 100).toFixed(3)}` } })],
        }),
        el("div", {
          className: "academy-continue-actions",
          children: [
            el("button", {
              className: "academy-button academy-button-primary academy-continue-start",
              attrs: { type: "button" },
              children: [el("span", { text: resume ? "Continue lesson" : "Start lesson" }), hubIcon("arrow")],
              on: { click: () => options.onStartLesson(next.id) },
            }),
            el("button", {
              className: "academy-button academy-button-link",
              attrs: { type: "button", "data-group-id": next.id },
              text: "View stop",
              on: { click: (event) => openGroup(next.id, { returnFocus: event.currentTarget as HTMLElement }) },
            }),
          ],
        }),
      ],
    });
  }

  function renderSummary(progress: AcademyProgress): void {
    const firstRun = progress.placementCompletedAt === null;
    const review = reviewButton(progress);
    summaryHost.replaceChildren(
      rankCard(progress),
      ...(review ? [review] : []),
      firstRun ? welcomeCard() : continueCard(progress),
    );
    element.classList.toggle("is-first-run", firstRun);
  }

  function renderTrail(progress: AcademyProgress): void {
    const focusedGroup = document.activeElement instanceof HTMLElement && trailHost.contains(document.activeElement) ? document.activeElement.dataset.groupId : undefined;
    const nextId = suggestNextGroup(progress)?.id ?? null;
    let index = 0;
    trailHost.replaceChildren(
      ...TRAIL_CONTINENTS.filter((continent) => continentFilter === null || continent === continentFilter).map((continent) => {
        const summary = continentSummary(progress, continent);
        const groups = LEARNING_GROUPS.filter((group) => group.continent === continent);
        const headingId = `academy-leg-${continent.toLowerCase().replace(/\s+/g, "-")}`;
        return el("section", {
          className: "academy-leg",
          attrs: { "aria-labelledby": headingId },
          children: [
            el("header", {
              className: "academy-leg-head",
              children: [
                el("h3", { attrs: { id: headingId }, text: continent }),
                el("p", { text: `${summary.completedGroups} of ${plural(summary.groupCount, "stop")} cleared · ${summary.percent}%` }),
                el("span", { className: "academy-leg-bar", attrs: { "aria-hidden": "true" }, children: [el("span", { attrs: { style: `--fill: ${(summary.percent / 100).toFixed(3)}` } })] }),
              ],
            }),
            el("ol", {
              className: "academy-leg-groups",
              children: groups.map((group) =>
                groupCard({
                  group,
                  summary: groupCompletion(progress, group),
                  countryIndex,
                  isNext: group.id === nextId,
                  isOpen: group.id === openGroupId,
                  index: index++,
                  onOpen: (target) => openGroup(target.id, { scrollToMap: true, returnFocus: trailHost.querySelector<HTMLElement>(`.academy-group-open[data-group-id="${target.id}"]`) }),
                }),
              ),
            }),
          ],
        });
      }),
    );
    if (focusedGroup) trailHost.querySelector<HTMLElement>(`.academy-group-open[data-group-id="${focusedGroup}"]`)?.focus({ preventScroll: true });
  }

  function renderPanel(progress: AcademyProgress): void {
    const group = openGroupId ? findGroup(openGroupId) : undefined;
    hero.classList.toggle("is-panel-open", !!group);
    element.classList.toggle("has-open-group", !!group);
    if (!group) {
      panelHost.replaceChildren();
      return;
    }
    const hadFocus = panelHost.contains(document.activeElement);
    panelHost.replaceChildren(
      groupPanel({
        group,
        progress,
        countryIndex,
        pickedCode,
        onClose: closeGroup,
        onStartLesson: options.onStartLesson,
        onOpenCountry: options.onOpenCountry,
        onHoverCountry: (code) => map.setHot(code),
      }),
    );
    if (hadFocus) panelHost.querySelector<HTMLElement>(".academy-panel-title")?.focus({ preventScroll: true });
  }

  function render(progress: AcademyProgress): void {
    map.update(progress);
    renderChips(progress);
    renderSummary(progress);
    renderTrail(progress);
    renderPanel(progress);
  }

  // ---------- Actions ----------
  let returnFocusTo: HTMLElement | null = null;

  function openGroup(groupId: string, openOptions: { readonly initial?: boolean; readonly fromMap?: boolean; readonly scrollToMap?: boolean; readonly returnFocus?: HTMLElement | null } = {}): void {
    const group = findGroup(groupId);
    if (!group) return;
    const changed = openGroupId !== group.id;
    openGroupId = group.id;
    if (!openOptions.fromMap) pickedCode = null;
    if (openOptions.returnFocus !== undefined) returnFocusTo = openOptions.returnFocus;
    map.setPicked(pickedCode);
    map.showGroup(group, { focus: true, animate: !openOptions.initial && !prefersReducedMotion() });
    const progress = progressStore.get();
    renderPanel(progress);
    renderTrail(progress);
    if (changed && !openOptions.initial) options.onGroupChange(group.id);
    if (openOptions.initial) {
      // Deep link: wait until the screen is mounted, then make sure the map is visible.
      window.requestAnimationFrame(() => revealMap(false));
      return;
    }
    const title = panelHost.querySelector<HTMLElement>(".academy-panel-title");
    title?.focus({ preventScroll: true });
    if (pickedCode) panelHost.querySelector<HTMLElement>(`[data-country="${pickedCode}"]`)?.scrollIntoView?.({ block: "nearest" });
    revealMap(openOptions.scrollToMap === true);
  }

  /**
   * Keep the highlighted map in view: on desktop scroll back up when opening from the trail
   * (the panel sits beside the map); on tablet/mobile park the map at the top so the bottom
   * sheet doesn't cover it.
   */
  function revealMap(fromTrail: boolean): void {
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 980px)").matches) {
      const top = map.element.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop - 8;
      element.scrollTo?.({ top: Math.max(0, top), behavior });
    } else if (fromTrail && element.scrollTop > 0) {
      element.scrollTo?.({ top: 0, behavior });
    }
  }

  function closeGroup(): void {
    if (!openGroupId) return;
    const closedId = openGroupId;
    openGroupId = null;
    pickedCode = null;
    map.setPicked(null);
    map.setHot(null);
    map.showGroup(null);
    map.focusContinent(continentFilter, { animate: !prefersReducedMotion() });
    const progress = progressStore.get();
    renderPanel(progress);
    renderTrail(progress);
    options.onGroupChange(null);
    const target = returnFocusTo?.isConnected ? returnFocusTo : trailHost.querySelector<HTMLElement>(`.academy-group-open[data-group-id="${closedId}"]`);
    returnFocusTo = null;
    // Don't yank the page to the trail when the group was opened from the map.
    target?.focus({ preventScroll: target === map.element });
  }

  function selectCountry(code: CountryCode, returnFocus: HTMLElement): void {
    const group = groupForCountry(code);
    if (!group) return;
    pickedCode = code.toUpperCase();
    openGroup(group.id, { fromMap: true, returnFocus });
  }

  function setContinent(continent: Continent | null): void {
    continentFilter = continent;
    chips.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-pressed", String(index === (continent ? TRAIL_CONTINENTS.indexOf(continent) + 1 : 0))));
    if (openGroupId) {
      const group = findGroup(openGroupId);
      if (group && continent && group.continent !== continent) closeGroup();
    }
    map.focusContinent(continent, { animate: !prefersReducedMotion() });
    renderTrail(progressStore.get());
  }

  function startFromScratch(): void {
    progressStore.update((progress) => skipPlacement(progress, now()));
    options.onStartLesson(suggestNextGroup(progressStore.get())?.id ?? LEARNING_GROUPS[0]!.id);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && openGroupId && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      closeGroup();
    }
  }
  element.addEventListener("keydown", onKeyDown);

  // ---------- Boot ----------
  render(progressStore.get());
  const unsubscribe = progressStore.subscribe((progress) => render(progress));

  if (options.initialGroupId) {
    if (findGroup(options.initialGroupId)) openGroup(options.initialGroupId, { initial: true });
    else options.onGroupChange(null);
  }

  return {
    element,
    destroy: () => {
      unsubscribe();
      element.removeEventListener("keydown", onKeyDown);
      map.destroy();
      siteHeader?.destroy();
    },
  };
}
