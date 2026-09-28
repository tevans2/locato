import {
  ACADEMY_SKILLS,
  boxOf,
  countryMastery,
  groupCompletion,
  lookalikesFor,
  MAX_BOX,
  type AcademyProgress,
  type AcademySkill,
  type LearningGroup,
  type MasteryLevel,
} from "../../../core/academy";
import type { CountryCode, CountryIndex } from "../../../core/countries";
import { el } from "../../dom/createElement";
import { completionRing, DIFFICULTY_LABELS, passportStamp } from "./hubCards";
import { hubIcon } from "./hubIcons";
import { MASTERY_LABELS } from "./MasteryMap";

export const SKILL_LABELS: Readonly<Record<AcademySkill, string>> = {
  flag: "Flag",
  shape: "Shape",
  capital: "Capital",
  map: "Map",
};

export interface GroupPanelOptions {
  readonly group: LearningGroup;
  readonly progress: AcademyProgress;
  readonly countryIndex: CountryIndex;
  readonly pickedCode: CountryCode | null;
  readonly onClose: () => void;
  readonly onStartLesson: (lessonId: string) => void;
  readonly onOpenCountry: (code: CountryCode) => void;
  readonly onHoverCountry: (code: CountryCode | null) => void;
}

/** The weakest country in the group that has a lookalike set: the drill most worth doing. */
export function lookalikeTarget(group: LearningGroup, progress: AcademyProgress): CountryCode | null {
  const candidates = group.countryCodes.filter((code) => lookalikesFor(code).length > 0);
  if (candidates.length === 0) return null;
  const strength = (code: CountryCode) => ACADEMY_SKILLS.reduce((sum, skill) => sum + boxOf(progress, code, skill), 0);
  return [...candidates].sort((a, b) => strength(a) - strength(b))[0] ?? null;
}

function skillPips(progress: AcademyProgress, code: CountryCode): HTMLElement {
  return el("span", {
    className: "academy-skill-pips",
    children: ACADEMY_SKILLS.map((skill) => {
      const box = boxOf(progress, code, skill);
      return el("span", {
        className: "academy-skill",
        attrs: { "data-skill": skill, title: `${SKILL_LABELS[skill]}: box ${box} of ${MAX_BOX}` },
        children: Array.from({ length: MAX_BOX }, (_, index) => el("i", { className: index < box ? "is-on" : "" })),
      });
    }),
  });
}

function countryRow(options: GroupPanelOptions, code: CountryCode): HTMLElement | null {
  const country = options.countryIndex.byCode.get(code);
  if (!country) return null;
  const level = countryMastery(options.progress, code);
  const skillSummary = ACADEMY_SKILLS.map((skill) => `${SKILL_LABELS[skill]} ${boxOf(options.progress, code, skill)} of ${MAX_BOX}`).join(", ");
  const button = el("button", {
    className: "academy-country-row",
    attrs: {
      type: "button",
      "data-country": code,
      "aria-label": `${country.name}, capital ${country.capital}. ${MASTERY_LABELS[level]}. ${skillSummary}. Open country profile.`,
    },
    children: [
      el("img", { className: "academy-country-flag", attrs: { src: country.flagSrc, alt: "", width: "36", height: "24", loading: "lazy", decoding: "async" } }),
      el("span", {
        className: "academy-country-text",
        children: [el("strong", { text: country.name }), el("span", { text: country.capital })],
      }),
      el("span", { className: "academy-mastery-chip", attrs: { "data-mastery": level }, text: MASTERY_LABELS[level] }),
      skillPips(options.progress, code),
      hubIcon("arrow", "academy-icon academy-row-arrow"),
    ],
    on: {
      click: () => options.onOpenCountry(code),
      pointerenter: () => options.onHoverCountry(code),
      pointerleave: () => options.onHoverCountry(null),
      focus: () => options.onHoverCountry(code),
      blur: () => options.onHoverCountry(null),
    },
  });
  return el("li", { className: code === options.pickedCode ? "is-picked" : "", children: [button] });
}

function countChip(level: MasteryLevel, count: number): HTMLElement {
  return el("li", {
    attrs: { "data-mastery": level },
    children: [el("span", { className: "academy-map-swatch", attrs: { "aria-hidden": "true" } }), el("strong", { text: String(count) }), document.createTextNode(` ${MASTERY_LABELS[level].toLowerCase()}`)],
  });
}

export function groupPanel(options: GroupPanelOptions): HTMLElement {
  const { group, progress } = options;
  const summary = groupCompletion(progress, group);
  const titleId = `academy-panel-title-${group.id}`;
  const lookalikeCode = lookalikeTarget(group, progress);
  const startLabel = summary.completed ? "Practise again" : summary.started ? "Continue lesson" : "Start lesson";

  const title = el("h2", { className: "academy-panel-title", text: group.title, attrs: { id: titleId, tabindex: "-1" } });
  const rows = group.countryCodes.map((code) => countryRow(options, code)).filter((row): row is HTMLElement => row !== null);

  return el("section", {
    className: `academy-panel${summary.completed ? " is-complete" : ""}`,
    attrs: { "aria-labelledby": titleId, "data-group-id": group.id },
    children: [
      el("span", { className: "academy-panel-grabber", attrs: { "aria-hidden": "true" } }),
      el("header", {
        className: "academy-panel-head",
        children: [
          el("div", {
            className: "academy-panel-heading",
            children: [
              el("p", { className: "academy-kicker", text: `${group.continent} · ${DIFFICULTY_LABELS[group.difficulty]}` }),
              title,
              el("p", { className: "academy-panel-blurb", text: group.blurb }),
            ],
          }),
          el("button", {
            className: "academy-icon-button academy-panel-close",
            attrs: { type: "button", "aria-label": "Close group" },
            children: [hubIcon("close")],
            on: { click: () => options.onClose() },
          }),
        ],
      }),
      el("div", {
        className: "academy-panel-summary",
        children: [
          completionRing(summary.percent, "lg", `${summary.percent}% of the way to mastering ${group.title}`),
          el("ul", {
            className: "academy-panel-counts",
            children: [countChip("mastered", summary.mastered), countChip("familiar", summary.familiar), countChip("learning", summary.learning), countChip("new", summary.new)],
          }),
          ...(summary.completed ? [passportStamp(group, true)] : []),
        ],
      }),
      el("div", {
        className: "academy-panel-actions",
        children: [
          el("button", {
            className: "academy-button academy-button-primary academy-panel-start",
            attrs: { type: "button" },
            children: [el("span", { text: startLabel }), hubIcon("arrow")],
            on: { click: () => options.onStartLesson(group.id) },
          }),
          ...(lookalikeCode
            ? [
                el("button", {
                  className: "academy-button academy-button-quiet academy-panel-lookalikes",
                  attrs: { type: "button", title: "Drill the countries people mix up with each other" },
                  children: [hubIcon("twins"), el("span", { text: "Lookalike drill" })],
                  on: { click: () => options.onStartLesson(`lookalikes:${lookalikeCode}`) },
                }),
              ]
            : []),
        ],
      }),
      el("div", {
        className: "academy-panel-list-head",
        attrs: { "aria-hidden": "true" },
        children: [
          el("span", { text: `${group.countryCodes.length} countries` }),
          el("span", { className: "academy-skill-legend", children: ACADEMY_SKILLS.map((skill) => el("span", { text: SKILL_LABELS[skill] })) }),
        ],
      }),
      el("ul", { className: "academy-country-list", attrs: { "aria-label": `Countries in ${group.title}` }, children: rows }),
    ],
  });
}
