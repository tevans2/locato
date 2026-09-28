import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import {
  ACADEMY_SKILLS,
  countryMastery,
  getCard,
  groupForCountry,
  lookalikesFor,
  type AcademyProgress,
  type AcademySkill,
  type LookalikeSet,
  type MasteryLevel,
} from "../../core/academy";
import {
  allCountryProfiles,
  formatArea,
  formatPopulation,
  formatRank,
  getCountryProfile,
  neighboursOf,
  PROFILE_COUNTRY_COUNT,
  type CountryProfile,
} from "../../core/countries/profiles";
import { el } from "../dom/createElement";
import { createBrandLockup } from "../dom/createBrandLockup";
import { profileIcon, type ProfileIconName } from "../components/academy/profileIcons";
import { createProfileSearch, type ProfileSearch } from "../components/academy/profileSearch";
import { createFeatureSilhouette, createProfileLocator, type ProfileLocator } from "../components/academy/profileLocator";
import {
  FAME_LABELS,
  areaComparison,
  distinctNativeNames,
  formatLatLng,
  hemispheres,
  otherCapitals,
  populationDensity,
  standfirst,
  unStatus,
} from "../components/academy/profileFacts";
import "../../styles/country-profile.css";

export interface CountryProfileScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** ISO alpha-2, upper case. May be unknown — render a friendly not-found state. */
  readonly code: string;
  readonly onBack: () => void;
  readonly onHome: () => void;
  /** Open another country's profile (neighbours, lookalikes). */
  readonly onOpenCountry: (code: string) => void;
  /** Flip to the previous/next country in the atlas; replaces the page rather than stacking history. Defaults to onOpenCountry. */
  readonly onFlipCountry?: (code: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
  readonly onOpenAcademy: (groupId?: string) => void;
}

const SKILL_LABELS: Readonly<Record<AcademySkill, string>> = {
  flag: "Flag",
  shape: "Outline",
  capital: "Capital",
  map: "On the map",
};

const LOOKALIKE_KIND: Readonly<Record<AcademySkill, string>> = {
  flag: "Similar flags",
  shape: "Similar outlines",
  capital: "Confusable capitals",
  map: "Easily swapped on the map",
};

const MASTERY_LABELS: Readonly<Record<MasteryLevel, string>> = {
  new: "Not started",
  learning: "Learning",
  familiar: "Familiar",
  mastered: "Mastered",
};

const MAX_BOX = 5;

// Outline assets that don't read well (date-line artefacts, hairline atoll rings); these are
// drawn from the map geometry instead.
const POOR_SHAPE_ASSETS = new Set(["KI", "MV", "TV", "MH", "FM", "PW", "TO"]);

function button(className: string, children: readonly Node[], onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  return el("button", { className, attrs: { type: "button", ...attrs }, children, on: { click: () => onClick() } });
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function absoluteAsset(src: string): string {
  try {
    return new URL(src, document.baseURI).href;
  } catch {
    return src;
  }
}

function shapeSilhouette(profile: CountryProfile, className = "cp-shape"): HTMLElement {
  const url = absoluteAsset(profile.shapeSrc).replace(/"/g, "%22");
  return el("div", {
    className,
    attrs: {
      role: "img",
      "aria-label": `Outline of ${profile.name}`,
      style: `-webkit-mask-image: url("${url}"); mask-image: url("${url}");`,
    },
  });
}

function flagImage(profile: CountryProfile, className: string, alt = `Flag of ${profile.name}`): HTMLImageElement {
  return el("img", { className, attrs: { src: profile.flagSrc, alt, decoding: "async" } });
}

function sectionHeading(index: string, title: string, id: string, kicker?: string): HTMLElement {
  return el("header", {
    className: "cp-section-head",
    children: [
      el("span", { className: "cp-section-index", text: index, attrs: { "aria-hidden": "true" } }),
      el("div", {
        className: "cp-section-titles",
        children: [
          ...(kicker ? [el("p", { className: "cp-section-kicker", text: kicker })] : []),
          el("h2", { className: "cp-section-title", text: title, attrs: { id } }),
        ],
      }),
    ],
  });
}

interface FactSpec {
  readonly icon: ProfileIconName;
  readonly label: string;
  readonly value: string | Node;
  readonly detail?: readonly (string | null | undefined)[];
  readonly wide?: boolean;
  readonly key: string;
}

function factCell(spec: FactSpec): HTMLElement {
  const details = (spec.detail ?? []).filter((line): line is string => Boolean(line));
  return el("div", {
    className: `cp-fact${spec.wide ? " is-wide" : ""}`,
    attrs: { "data-fact": spec.key },
    children: [
      el("dt", { className: "cp-fact-label", children: [profileIcon(spec.icon, "cp-icon cp-fact-icon"), text(spec.label)] }),
      el("dd", {
        className: "cp-fact-body",
        children: [
          el("span", { className: "cp-fact-value", children: [typeof spec.value === "string" ? text(spec.value) : spec.value] }),
          ...details.map((line) => el("span", { className: "cp-fact-detail", text: line })),
        ],
      }),
    ],
  });
}

function sortedProfiles(): readonly CountryProfile[] {
  return [...allCountryProfiles()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function createCountryProfileScreen(options: CountryProfileScreenOptions): Screen {
  const previousTitle = document.title;
  const profile = getCountryProfile(options.code);
  const ordered = sortedProfiles();
  const cleanups: (() => void)[] = [];

  const featureByCode = new Map(options.worldCountryFeatures.map((f) => [f.code.toUpperCase(), f]));
  function silhouette(p: CountryProfile, className = "cp-shape"): Element {
    const feature = POOR_SHAPE_ASSETS.has(p.code) ? featureByCode.get(p.code) : undefined;
    const drawn = feature ? createFeatureSilhouette(feature, p.capitalLatLng ?? p.latlng, `Outline of ${p.name}`) : null;
    if (drawn) {
      drawn.classList.add(className);
      return drawn;
    }
    return shapeSilhouette(p, className);
  }

  const searches: ProfileSearch[] = [];
  function searchPicker(placeholder?: string): HTMLElement {
    const search = createProfileSearch({
      profiles: ordered,
      countryIndex: options.countryIndex,
      onSelect: (code) => options.onOpenCountry(code),
      ...(placeholder ? { placeholder } : {}),
    });
    searches.push(search);
    return search.element;
  }

  const index = profile ? ordered.findIndex((p) => p.code === profile.code) : -1;
  const prev = index >= 0 ? ordered[(index - 1 + ordered.length) % ordered.length]! : null;
  const next = index >= 0 ? ordered[(index + 1) % ordered.length]! : null;
  const flip = (code: string): void => (options.onFlipCountry ?? options.onOpenCountry)(code);

  const topbar = el("header", {
    className: "cp-topbar",
    children: [
      createBrandLockup(options.onHome),
      el("nav", {
        className: "cp-crumbs",
        attrs: { "aria-label": "Breadcrumb" },
        children: [
          button("cp-crumb", [text("Academy")], () => options.onOpenAcademy()),
          el("span", { className: "cp-crumb-sep", text: "/", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "cp-crumb is-current", text: "Atlas", attrs: { "aria-current": "page" } }),
        ],
      }),
      button("ghost-action cp-back", [profileIcon("arrowLeft"), el("span", { className: "cp-back-label", text: "Back" })], options.onBack, { "aria-label": "Go back" }),
    ],
  });

  const atlasBar = el("div", {
    className: "cp-atlasbar",
    children: [
      el("p", { className: "cp-atlasbar-title", children: [profileIcon("compass"), el("span", { text: `The atlas · ${PROFILE_COUNTRY_COUNT} countries` })] }),
      searchPicker(),
      ...(prev && next
        ? [
            el("div", {
              className: "cp-stepper",
              attrs: { role: "group", "aria-label": "Browse alphabetically" },
              children: [
                button("cp-step cp-step-prev", [profileIcon("arrowLeft")], () => flip(prev.code), { "aria-label": `Previous country: ${prev.name}`, title: `${prev.name} (←)` }),
                el("span", { className: "cp-step-count", text: `${index + 1} / ${ordered.length}`, attrs: { "aria-hidden": "true" } }),
                button("cp-step cp-step-next", [profileIcon("arrowRight")], () => flip(next.code), { "aria-label": `Next country: ${next.name}`, title: `${next.name} (→)` }),
              ],
            }),
          ]
        : []),
    ],
  });

  const page = el("main", { className: "cp-page" });
  const element = el("section", {
    className: `country-profile-screen${profile ? "" : " is-not-found"}`,
    attrs: {
      id: "country-profile", "aria-label": profile ? `${profile.name} country profile` : "Country not found" },
    children: [topbar, atlasBar, page],
  });

  let locator: ProfileLocator | null = null;

  if (!profile) {
    document.title = "Country not found · Locato";
    renderNotFound();
  } else {
    document.title = `${profile.name} · Locato`;
    element.dataset.country = profile.code;
    renderProfile(profile);

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (!element.isConnected) return;
      if (event.key === "ArrowLeft" && prev) { event.preventDefault(); flip(prev.code); }
      if (event.key === "ArrowRight" && next) { event.preventDefault(); flip(next.code); }
    };
    document.addEventListener("keydown", onKey);
    cleanups.push(() => document.removeEventListener("keydown", onKey));
  }

  function renderNotFound(): void {
    const code = options.code.trim().toUpperCase();
    const suggestions = ["JP", "BR", "ZA", "IS", "NP", "NZ"].map((c) => getCountryProfile(c)).filter((p): p is CountryProfile => p !== null);
    page.append(
      el("div", {
        className: "cp-notfound",
        children: [
          el("p", { className: "cp-kicker", text: code ? `No entry for “${code.slice(0, 12)}”` : "No country chosen" }),
          el("h1", { className: "cp-notfound-title", text: "That page isn’t in our atlas." }),
          el("p", { className: "cp-notfound-copy", text: `Search any of the ${PROFILE_COUNTRY_COUNT} countries by name, nickname or capital — or open one of these to start exploring.` }),
          searchPicker("Try “Japan”, “Holland” or “Nairobi”…"),
          el("ul", {
            className: "cp-suggestions",
            attrs: { "aria-label": "Suggested countries" },
            children: suggestions.map((p) => el("li", { children: [countryChip(p)] })),
          }),
          el("div", {
            className: "cp-notfound-actions",
            children: [
              button("cp-btn cp-btn-primary", [profileIcon("shuffle"), text("Surprise me")], () => {
                const pick = ordered[Math.floor(Math.random() * ordered.length)];
                if (pick) options.onOpenCountry(pick.code);
              }),
              button("cp-btn cp-btn-quiet", [profileIcon("cap"), text("Go to the Academy")], () => options.onOpenAcademy()),
            ],
          }),
        ],
      }),
    );
  }

  function countryChip(p: CountryProfile, extraClass = ""): HTMLButtonElement {
    return button(`cp-chip${extraClass}`, [flagImage(p, "cp-chip-flag", ""), el("span", { className: "cp-chip-name", text: p.name })], () => options.onOpenCountry(p.code), {
      "aria-label": `Open ${p.name}`,
      "data-code": p.code,
    });
  }

  function renderProfile(p: CountryProfile): void {
    const group = groupForCountry(p.code);
    const neighbours = neighboursOf(p.code);
    const population = formatPopulation(p.populationMillions);

    // ---- Hero -----------------------------------------------------------------------------
    const natives = distinctNativeNames(p);
    const fame = FAME_LABELS[p.fameTier];
    const masteryPanel = el("div", { className: "cp-mastery", attrs: { "aria-live": "polite" } });
    const renderMastery = (progress: AcademyProgress) => masteryPanel.replaceChildren(...masteryContent(p, progress, group?.id));
    renderMastery(options.progressStore.get());
    cleanups.push(options.progressStore.subscribe(renderMastery));

    const hero = el("header", {
      className: "cp-hero cp-reveal",
      children: [
        el("div", {
          className: "cp-hero-copy",
          children: [
            el("p", {
              className: "cp-kicker",
              children: [
                el("span", { className: "cp-emoji", text: p.flagEmoji, attrs: { "aria-hidden": "true" } }),
                el("span", { text: p.continent }),
                ...(p.subregion && p.subregion !== p.continent ? [el("span", { className: "cp-kicker-sep", text: "·", attrs: { "aria-hidden": "true" } }), el("span", { text: p.subregion })] : []),
              ],
            }),
            el("h1", { className: "cp-name", text: p.name }),
            ...(p.officialName && p.officialName !== p.name ? [el("p", { className: "cp-official", text: p.officialName })] : []),
            ...(natives.length
              ? [
                  el("p", {
                    className: "cp-native",
                    children: natives.flatMap((n, i) => [
                      ...(i > 0 ? [el("span", { className: "cp-native-sep", text: "·", attrs: { "aria-hidden": "true" } })] : []),
                      el("span", { className: "cp-native-name", text: n.name }),
                      el("span", { className: "cp-native-lang", text: n.language }),
                    ]),
                  }),
                ]
              : []),
            el("p", { className: "cp-standfirst", text: standfirst(p, population) }),
            el("div", {
              className: "cp-badges",
              children: [
                el("span", {
                  className: `cp-badge cp-difficulty tier-${p.fameTier}`,
                  attrs: { title: fame.detail },
                  children: [
                    el("span", { className: "cp-difficulty-dots", attrs: { "aria-hidden": "true" }, children: [1, 2, 3].map((n) => el("i", { className: n <= p.fameTier ? "is-on" : "" })) }),
                    text(`${fame.title} · ${fame.detail}`),
                  ],
                }),
                ...(group ? [button("cp-badge cp-badge-link", [profileIcon("cap"), text(group.title)], () => options.onOpenAcademy(group.id), { "aria-label": `Open the ${group.title} group in the Academy` })] : []),
              ],
            }),
            masteryPanel,
          ],
        }),
        el("figure", {
          className: "cp-flag-plate",
          children: [
            el("div", { className: "cp-flag-stage", children: [flagImage(p, "cp-flag")] }),
            el("figcaption", {
              className: "cp-plate-caption",
              children: [el("span", { text: "National flag" }), el("span", { className: "cp-plate-code", text: `${p.code} · ${p.cca3}` })],
            }),
          ],
        }),
      ],
    });

    // ---- Where in the world ---------------------------------------------------------------
    locator = createProfileLocator({
      profile: p,
      neighbourCodes: neighbours.map((n) => n.code),
      features: options.worldCountryFeatures,
      countryIndex: options.countryIndex,
      onOpenCountry: options.onOpenCountry,
    });

    const legend = el("ul", {
      className: "cp-legend",
      attrs: { "aria-label": "Map key" },
      children: [
        el("li", { children: [el("i", { className: "cp-key is-self" }), text(p.name)] }),
        ...(neighbours.length ? [el("li", { children: [el("i", { className: "cp-key is-neighbour" }), text("Neighbours (click to visit)")] })] : []),
        ...(p.capitalLatLng ? [el("li", { children: [el("i", { className: "cp-key is-capital" }), text(`Capital: ${p.capital}`)] })] : []),
      ],
    });

    const neighbourBlock = el("div", {
      className: "cp-neighbours",
      children: [
        el("h3", { className: "cp-subhead", text: neighbours.length ? `${neighbours.length} land ${neighbours.length === 1 ? "neighbour" : "neighbours"}` : "Neighbours" }),
        neighbours.length
          ? el("ul", { className: "cp-chip-row", children: neighbours.map((n) => el("li", { children: [countryChip(n, " cp-neighbour-chip")] })) })
          : el("p", {
              className: "cp-empty-note",
              text: p.landlocked ? "No land borders." : `No land borders — ${p.name} is surrounded by sea.`,
            }),
      ],
    });

    const where = el("section", {
      className: "cp-section cp-where cp-reveal",
      attrs: { "aria-labelledby": "cp-where-title" },
      children: [
        sectionHeading("01", "Where in the world", "cp-where-title", "Location"),
        el("div", {
          className: "cp-where-grid",
          children: [
            el("div", { className: "cp-map-card", children: [locator.element, legend] }),
            el("aside", {
              className: "cp-where-aside",
              attrs: { "aria-label": "Shape and position" },
              children: [
                el("figure", {
                  className: "cp-shape-plate",
                  children: [el("div", { className: "cp-shape-frame", children: [silhouette(p)] }), el("figcaption", { className: "cp-plate-caption", children: [el("span", { text: "Outline" }), el("span", { className: "cp-plate-code", text: "Not to scale" })] })],
                }),
                el("dl", {
                  className: "cp-coords",
                  children: [
                    el("div", { children: [el("dt", { text: "Centre" }), el("dd", { text: formatLatLng(p.latlng) })] }),
                    ...(p.capitalLatLng ? [el("div", { children: [el("dt", { text: p.capital }), el("dd", { text: formatLatLng(p.capitalLatLng) })] })] : []),
                    el("div", { children: [el("dt", { text: "Hemispheres" }), el("dd", { text: hemispheres(p.latlng) })] }),
                  ],
                }),
              ],
            }),
          ],
        }),
        neighbourBlock,
      ],
    });

    // ---- At a glance ----------------------------------------------------------------------
    const extraCapitals = otherCapitals(p);
    const currencyLines = p.currencies.map((c) => `${c.code}${c.symbol ? ` (${c.symbol})` : ""}`);
    const languagesValue = el("span", {
      className: "cp-lang-list",
      children: p.languages.map((lang) => el("span", { className: "cp-lang", text: lang })),
    });
    const un = unStatus(p);
    const facts: FactSpec[] = [
      {
        key: "capital",
        icon: "capital",
        label: extraCapitals.length ? "Capitals" : "Capital",
        value: p.capital,
        detail: extraCapitals.length ? [`Also ${extraCapitals.join(" and ")}`] : [],
      },
      {
        key: "population",
        icon: "people",
        label: "Population",
        value: population,
        detail: [p.populationRank ? formatRank(p.populationRank, "most populous") : null, populationDensity(p)],
      },
      {
        key: "area",
        icon: "area",
        label: "Area",
        value: formatArea(p.areaKm2),
        detail: [formatRank(p.areaRank, "largest"), areaComparison(p.areaKm2, p.code)],
      },
      {
        key: "languages",
        icon: "language",
        label: p.languages.length === 1 ? "Language" : `Languages · ${p.languages.length}`,
        value: languagesValue,
        wide: p.languages.length > 4,
      },
      {
        key: "currency",
        icon: "currency",
        label: p.currencies.length > 1 ? "Currencies" : "Currency",
        value: p.currencies.map((c) => c.name).join(" & ") || "—",
        detail: [currencyLines.join(", ")],
      },
      { key: "demonym", icon: "demonym", label: "People are called", value: p.demonym || "—" },
      { key: "calling", icon: "phone", label: "Calling code", value: p.callingCode ?? "—" },
      { key: "tld", icon: "web", label: "Web domain", value: p.tld[0] ?? "—", detail: p.tld.length > 1 ? [`Also ${p.tld.slice(1).join(", ")}`] : [] },
      { key: "driving", icon: "road", label: "Drives on the", value: p.drivingSide === "left" ? "Left" : "Right" },
      {
        key: "coast",
        icon: p.landlocked ? "lock" : "coast",
        label: "Coastline",
        value: p.landlocked ? "Landlocked" : "Coastal",
        detail: [p.landlocked ? "No access to the open sea" : p.borders.length === 0 ? "Surrounded by water" : "Has a sea coast"],
      },
      ...(p.highestPoint
        ? [{ key: "highest", icon: "mountain" as const, label: "Highest point", value: p.highestPoint.name, detail: [`${p.highestPoint.metres.toLocaleString("en-US")} m above sea level`] }]
        : []),
      { key: "un", icon: "un", label: "United Nations", value: un.value, detail: [un.detail] },
    ];

    const glance = el("section", {
      className: "cp-section cp-glance cp-reveal",
      attrs: { "aria-labelledby": "cp-glance-title" },
      children: [sectionHeading("02", "At a glance", "cp-glance-title", "Quick facts"), el("dl", { className: "cp-facts", children: facts.map(factCell) })],
    });

    // ---- How to remember it ---------------------------------------------------------------
    const remember = el("section", {
      className: "cp-section cp-remember cp-reveal",
      attrs: { "aria-labelledby": "cp-remember-title" },
      children: [
        sectionHeading("03", "How to remember it", "cp-remember-title", "Memory hooks"),
        el("div", {
          className: "cp-memory-grid",
          children: [
            el("article", {
              className: "cp-memory-card is-shape",
              children: [
                el("div", { className: "cp-memory-tab", children: [profileIcon("pin"), text("Shape & place")] }),
                el("p", { className: "cp-memory-text", text: p.hook }),
                silhouette(p, "cp-memory-shape"),
              ],
            }),
            el("article", {
              className: "cp-memory-card is-flag",
              children: [
                el("div", { className: "cp-memory-tab", children: [profileIcon("flag"), text("The flag")] }),
                el("p", { className: "cp-memory-text", text: p.flagNote }),
                flagImage(p, "cp-memory-flag", ""),
              ],
            }),
          ],
        }),
        el("div", {
          className: "cp-notes-grid",
          children: [
            el("div", {
              className: "cp-funfacts",
              children: [
                el("h3", { className: "cp-subhead", children: [profileIcon("spark"), text("Did you know?")] }),
                el("ol", {
                  className: "cp-funfact-list",
                  children: p.funFacts.map((fact, i) => el("li", { children: [el("span", { className: "cp-funfact-num", text: String(i + 1).padStart(2, "0"), attrs: { "aria-hidden": "true" } }), el("p", { text: fact })] })),
                }),
              ],
            }),
            el("div", {
              className: "cp-landmarks",
              children: [
                el("h3", { className: "cp-subhead", children: [profileIcon("pin"), text("Famous places")] }),
                el("ul", { className: "cp-landmark-list", children: p.landmarks.map((landmark) => el("li", { text: landmark })) }),
              ],
            }),
          ],
        }),
      ],
    });

    // ---- Lookalikes -----------------------------------------------------------------------
    const sets = lookalikesFor(p.code);
    const lookalikes = sets.length
      ? el("section", {
          className: "cp-section cp-lookalikes cp-reveal",
          attrs: { "aria-labelledby": "cp-lookalikes-title" },
          children: [
            sectionHeading("04", "Don’t mix it up with", "cp-lookalikes-title", "Common confusions"),
            el("div", { className: "cp-lookalike-list", children: sets.map((set) => lookalikeCard(p, set)) }),
            el("div", {
              className: "cp-drill-row",
              children: [
                el("p", { className: "cp-drill-copy", text: "Mixed these up before? A short drill puts them side by side until the difference sticks." }),
                button("cp-btn cp-btn-primary cp-drill", [profileIcon("shuffle"), text("Drill these")], () => options.onStartLesson(`lookalikes:${p.code}`), {
                  "aria-label": `Drill ${p.name} against its lookalikes`,
                }),
              ],
            }),
          ],
        })
      : null;

    // ---- Learn it -------------------------------------------------------------------------
    const learn = group
      ? el("section", {
          className: "cp-learn cp-reveal",
          attrs: { "aria-labelledby": "cp-learn-title" },
          children: [
            el("div", { className: "cp-learn-mark", children: [profileIcon("cap")] }),
            el("div", {
              className: "cp-learn-copy",
              children: [
                el("p", { className: "cp-learn-kicker", text: `Part of an Academy group · ${group.countryCodes.length} countries` }),
                el("h2", { className: "cp-learn-title", text: group.title, attrs: { id: "cp-learn-title" } }),
                el("p", { className: "cp-learn-blurb", text: group.blurb }),
                el("ul", {
                  className: "cp-learn-flags",
                  attrs: { "aria-label": `Countries in ${group.title}` },
                  children: group.countryCodes
                    .map((code) => getCountryProfile(code))
                    .filter((g): g is CountryProfile => g !== null)
                    .map((g) =>
                      el("li", {
                        children: [
                          g.code === p.code
                            ? el("span", { className: "cp-learn-flag is-current", attrs: { title: `${g.name} (this country)` }, children: [flagImage(g, "", `${g.name} (this country)`)] })
                            : button("cp-learn-flag", [flagImage(g, "", "")], () => options.onOpenCountry(g.code), { "aria-label": `Open ${g.name}`, title: g.name }),
                        ],
                      }),
                    ),
                }),
              ],
            }),
            el("div", {
              className: "cp-learn-actions",
              children: [
                button("cp-btn cp-btn-primary", [text("Practise this group"), profileIcon("arrowRight")], () => options.onStartLesson(group.id), { "data-action": "practise" }),
                button("cp-btn cp-btn-quiet", [text("Open in the Academy")], () => options.onOpenAcademy(group.id), { "data-action": "open-group" }),
              ],
            }),
          ],
        })
      : null;

    // ---- Browse ---------------------------------------------------------------------------
    const browse = prev && next
      ? el("nav", {
          className: "cp-browse cp-reveal",
          attrs: { "aria-label": "Previous and next country" },
          children: [
            button("cp-browse-link is-prev", [
              profileIcon("arrowLeft"),
              el("span", { className: "cp-browse-text", children: [el("span", { className: "cp-browse-dir", text: "Previous" }), el("span", { className: "cp-browse-name", text: prev.name })] }),
              flagImage(prev, "cp-browse-flag", ""),
            ], () => flip(prev.code), { "data-code": prev.code }),
            el("p", { className: "cp-browse-hint", children: [text("Use "), el("kbd", { text: "←" }), text(" "), el("kbd", { text: "→" }), text(" to flip pages")] }),
            button("cp-browse-link is-next", [
              flagImage(next, "cp-browse-flag", ""),
              el("span", { className: "cp-browse-text", children: [el("span", { className: "cp-browse-dir", text: "Next" }), el("span", { className: "cp-browse-name", text: next.name })] }),
              profileIcon("arrowRight"),
            ], () => flip(next.code), { "data-code": next.code }),
          ],
        })
      : null;

    page.append(...[hero, where, glance, remember, lookalikes, learn, browse].filter((node): node is HTMLElement => node !== null));
  }

  function masteryContent(p: CountryProfile, progress: AcademyProgress, groupId: string | undefined): Node[] {
    const level = countryMastery(progress, p.code);
    const boxes = ACADEMY_SKILLS.map((skill) => ({ skill, box: getCard(progress, p.code, skill).box }));
    masteryPanelLevel(level);
    if (level === "new") {
      return [
        el("p", { className: "cp-mastery-empty", children: [el("span", { className: "cp-mastery-dot", attrs: { "aria-hidden": "true" } }), text(`You haven’t studied ${p.name} yet.`)] }),
        ...(groupId ? [button("cp-link-btn", [text("Learn it now"), profileIcon("arrowRight")], () => options.onStartLesson(groupId), { "data-action": "learn-now" })] : []),
      ];
    }
    return [
      el("div", {
        className: "cp-mastery-head",
        children: [el("span", { className: "cp-mastery-label", text: "Your progress" }), el("span", { className: `cp-level is-${level}`, text: MASTERY_LABELS[level] })],
      }),
      el("ul", {
        className: "cp-skill-list",
        children: boxes.map(({ skill, box }) =>
          el("li", {
            className: "cp-skill",
            attrs: { "aria-label": `${SKILL_LABELS[skill]}: ${box} of ${MAX_BOX}` },
            children: [
              el("span", { className: "cp-skill-name", text: SKILL_LABELS[skill], attrs: { "aria-hidden": "true" } }),
              el("span", {
                className: "cp-pips",
                attrs: { "aria-hidden": "true" },
                children: Array.from({ length: MAX_BOX }, (_, i) => el("i", { className: i < box ? "is-on" : "" })),
              }),
            ],
          }),
        ),
      }),
    ];
  }

  function masteryPanelLevel(level: MasteryLevel): void {
    element.dataset.mastery = level;
  }

  function lookalikeCard(p: CountryProfile, set: LookalikeSet): HTMLElement {
    const members = [p.code, ...set.codes.filter((code) => code !== p.code)]
      .map((code) => getCountryProfile(code))
      .filter((m): m is CountryProfile => m !== null);
    const visual = (m: CountryProfile): HTMLElement => {
      if (set.skill === "flag") return el("div", { className: "cp-look-visual is-flag", children: [flagImage(m, "cp-look-flag", "")] });
      if (set.skill === "capital") return el("div", { className: "cp-look-visual is-capital", children: [el("span", { className: "cp-look-capital", text: m.capital })] });
      return el("div", { className: "cp-look-visual is-shape", children: [silhouette(m, "cp-look-shape")] });
    };
    return el("article", {
      className: `cp-look-card skill-${set.skill}`,
      attrs: { "data-skill": set.skill },
      children: [
        el("p", { className: "cp-look-kind", text: LOOKALIKE_KIND[set.skill] }),
        el("ul", {
          className: `cp-look-row count-${members.length}`,
          children: members.map((m) =>
            el("li", {
              children: [
                m.code === p.code
                  ? el("div", {
                      className: "cp-look-item is-self",
                      children: [visual(m), el("span", { className: "cp-look-name", children: [text(m.name), el("span", { className: "cp-look-this", text: "this one" })] })],
                    })
                  : button("cp-look-item", [visual(m), el("span", { className: "cp-look-name", text: m.name })], () => options.onOpenCountry(m.code), {
                      "aria-label": `Open ${m.name}`,
                      "data-code": m.code,
                    }),
              ],
            }),
          ),
        }),
        el("p", { className: "cp-look-tip", text: set.tip }),
      ],
    });
  }

  return {
    element,
    destroy: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const search of searches) search.destroy();
      locator?.destroy();
      document.title = previousTitle;
    },
  };
}

