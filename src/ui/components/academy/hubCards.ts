import type { CompletionSummary, LearningGroup } from "../../../core/academy";
import type { CountryIndex } from "../../../core/countries";
import { el } from "../../dom/createElement";

const SVG_NS = "http://www.w3.org/2000/svg";

export const DIFFICULTY_LABELS: Readonly<Record<LearningGroup["difficulty"], string>> = {
  1: "Starter",
  2: "Regional",
  3: "Deep cuts",
};

/** Circular completion meter. `percent` is 0–100; the fill animates in via CSS. */
export function completionRing(percent: number, size: "sm" | "lg" = "sm", label?: string): HTMLElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const track = document.createElementNS(SVG_NS, "circle");
  const fill = document.createElementNS(SVG_NS, "circle");
  for (const circle of [track, fill]) {
    circle.setAttribute("cx", "20");
    circle.setAttribute("cy", "20");
    circle.setAttribute("r", "16");
    circle.setAttribute("pathLength", "100");
  }
  track.setAttribute("class", "academy-ring-track");
  fill.setAttribute("class", "academy-ring-fill");
  svg.append(track, fill);
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return el("span", {
    className: `academy-ring academy-ring-${size}${clamped >= 100 ? " is-full" : ""}`,
    attrs: { style: `--ring-pct: ${clamped}`, ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" }) },
    children: [svg as unknown as Node, el("span", { className: "academy-ring-value", text: `${clamped}%` })],
  });
}

/** Overlapping mini flags, like a row of stamps in a passport. */
export function flagStrip(codes: readonly string[], countryIndex: CountryIndex, max = 8): HTMLElement {
  const shown = codes.slice(0, max);
  const children: Node[] = shown.map((code, index) => {
    const country = countryIndex.byCode.get(code);
    return el("img", {
      className: "academy-flag-chip",
      attrs: { src: country?.flagSrc ?? "", alt: "", loading: "lazy", decoding: "async", width: "24", height: "16", style: `--i: ${index}` },
    });
  });
  if (codes.length > max) children.push(el("span", { className: "academy-flag-more", text: `+${codes.length - max}` }));
  return el("span", { className: "academy-flag-strip", attrs: { "aria-hidden": "true" }, children });
}

export function difficultyMeter(difficulty: LearningGroup["difficulty"]): HTMLElement {
  return el("span", {
    className: "academy-difficulty",
    attrs: { "data-difficulty": String(difficulty), title: `Difficulty: ${DIFFICULTY_LABELS[difficulty]}` },
    children: [
      el("span", { className: "academy-difficulty-pips", attrs: { "aria-hidden": "true" }, children: [1, 2, 3].map((step) => el("i", { className: step <= difficulty ? "is-on" : "" })) }),
      el("span", { text: DIFFICULTY_LABELS[difficulty] }),
    ],
  });
}

/** The "passport stamp" given to a cleared group. */
export function passportStamp(group: LearningGroup, compact = false): HTMLElement {
  return el("span", {
    className: `academy-stamp${compact ? " is-compact" : ""}`,
    attrs: { "aria-hidden": "true" },
    children: [
      el("span", { className: "academy-stamp-top", text: group.continent }),
      el("span", { className: "academy-stamp-main", text: "Cleared" }),
      el("span", { className: "academy-stamp-bottom", text: `No. ${String(group.order + 1).padStart(2, "0")}` }),
    ],
  });
}

export interface GroupCardOptions {
  readonly group: LearningGroup;
  readonly summary: CompletionSummary;
  readonly countryIndex: CountryIndex;
  readonly isNext: boolean;
  readonly isOpen: boolean;
  readonly index: number;
  readonly onOpen: (group: LearningGroup) => void;
}

export function groupCard(options: GroupCardOptions): HTMLElement {
  const { group, summary } = options;
  const state = summary.completed ? "complete" : summary.started ? "started" : "new";
  const descriptionId = `academy-group-desc-${group.id}`;
  const statusText = summary.completed
    ? `Cleared. ${summary.mastered} of ${summary.total} mastered.`
    : `${summary.percent}% complete. ${summary.mastered} of ${summary.total} mastered.`;

  const openButton = el("button", {
    className: "academy-group-open",
    text: group.title,
    attrs: { type: "button", "aria-describedby": descriptionId, "aria-expanded": String(options.isOpen), "data-group-id": group.id },
    on: { click: () => options.onOpen(group) },
  });

  return el("li", {
    className: `academy-group-card is-${state}${options.isNext ? " is-next" : ""}${options.isOpen ? " is-open" : ""}`,
    attrs: { style: `--i: ${options.index}`, "data-group-id": group.id },
    children: [
      el("span", { className: "academy-waypoint", attrs: { "aria-hidden": "true" }, text: String(group.order + 1) }),
      el("div", {
        className: "academy-group-card-head",
        children: [
          difficultyMeter(group.difficulty),
          ...(options.isNext ? [el("span", { className: "academy-next-tag", text: summary.started ? "Continue here" : "Up next" })] : []),
        ],
      }),
      el("h3", { className: "academy-group-title", children: [openButton] }),
      el("p", { className: "academy-group-blurb", text: group.blurb }),
      flagStrip(group.countryCodes, options.countryIndex),
      el("div", {
        className: "academy-group-card-foot",
        children: [
          completionRing(summary.percent),
          el("span", {
            className: "academy-group-count",
            children: [el("strong", { text: `${summary.mastered}/${summary.total}` }), el("span", { text: " mastered" })],
          }),
        ],
      }),
      el("span", { className: "academy-sr-only", attrs: { id: descriptionId }, text: `${DIFFICULTY_LABELS[group.difficulty]}. ${statusText}` }),
      ...(summary.completed ? [passportStamp(group)] : []),
    ],
  });
}
