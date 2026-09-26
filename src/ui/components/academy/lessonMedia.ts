import type { Country, CountryCode, CountryIndex } from "../../../core/countries";
import type { AcademySkill } from "../../../core/academy";
import { el } from "../../dom/createElement";

/** Shared visual atoms for lesson and placement steps: flags, outlines, icons and copy. */

const SVG_NS = "http://www.w3.org/2000/svg";

export function outlineSrc(code: CountryCode): string {
  return `assets/country-shapes/${code.toLowerCase()}.svg`;
}

export function countryOf(index: CountryIndex, code: CountryCode): Country | undefined {
  return index.byCode.get(code.toUpperCase());
}

export function countryName(index: CountryIndex, code: CountryCode): string {
  return countryOf(index, code)?.name ?? code;
}

export function flagImage(country: Country | undefined, className = "lx-flag", decorative = false): HTMLElement {
  if (!country) return el("span", { className: `${className} is-missing` });
  const image = el("img", {
    className,
    attrs: {
      src: country.flagSrc,
      alt: decorative ? "" : "A country's flag",
      draggable: "false",
      decoding: "async",
    },
  });
  return image;
}

/** Silhouette drawn with a CSS mask so it takes the theme's ink colour in light and dark. */
export function outlineImage(code: CountryCode, className = "lx-outline"): HTMLElement {
  const src = `url("${outlineSrc(code)}")`;
  const shape = el("span", { className, attrs: { role: "img", "aria-label": "A country's outline" } });
  shape.style.setProperty("--lx-shape", src);
  return shape;
}

export function icon(name: "close" | "check" | "nudge" | "flame" | "arrow" | "book" | "compass" | "spark" | "retry"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `lx-icon lx-icon-${name}`);
  const path = (d: string, extra: Record<string, string> = {}): SVGPathElement => {
    const node = document.createElementNS(SVG_NS, "path");
    node.setAttribute("d", d);
    for (const [key, value] of Object.entries(extra)) node.setAttribute(key, value);
    return node;
  };
  const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" };
  switch (name) {
    case "close":
      svg.append(path("M6 6l12 12M18 6L6 18", stroke));
      break;
    case "check":
      svg.append(path("M5 12.5l4.2 4.2L19 7", { ...stroke, "stroke-width": "3" }));
      break;
    case "nudge":
      // A friendly "hmm" — a curved arrow pointing back, not an alarm cross.
      svg.append(path("M9 7L5 11l4 4", { ...stroke, "stroke-width": "2.8" }), path("M5.5 11H14a5 5 0 010 10h-2", { ...stroke, "stroke-width": "2.8" }));
      break;
    case "flame":
      svg.append(path("M12 2.5c.6 3.2 4.8 5.3 4.8 10a4.8 4.8 0 01-9.6 0c0-2.2 1.2-3.6 2.3-4.6.1 1.6.8 2.7 1.9 3.1-.6-3 .1-5.9.6-8.5z", { fill: "currentColor" }));
      break;
    case "arrow":
      svg.append(path("M5 12h14M13 6l6 6-6 6", stroke));
      break;
    case "book":
      svg.append(path("M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z", stroke), path("M4 20.5A2.5 2.5 0 006.5 23H20", stroke));
      break;
    case "compass":
      svg.append(path("M12 3a9 9 0 100 18 9 9 0 000-18z", stroke), path("M15.5 8.5l-2 5-5 2 2-5z", { ...stroke, fill: "currentColor" }));
      break;
    case "spark":
      svg.append(path("M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z", { fill: "currentColor" }));
      break;
    case "retry":
      svg.append(path("M4 12a8 8 0 0113.7-5.6L20 8.5", stroke), path("M20 3.5v5h-5", stroke), path("M20 12a8 8 0 01-13.7 5.6", stroke));
      break;
  }
  return svg;
}

export function skillLabel(skill: AcademySkill): string {
  switch (skill) {
    case "flag":
      return "Flag";
    case "shape":
      return "Outline";
    case "capital":
      return "Capital";
    case "map":
      return "Map";
  }
}

export function choicePromptTitle(skill: AcademySkill, name: string): string {
  switch (skill) {
    case "flag":
      return "Which country flies this flag?";
    case "shape":
      return "Which country has this shape?";
    case "capital":
      return `What's the capital of ${name}?`;
    case "map":
      return "Which country is highlighted?";
  }
}

export function typePromptTitle(skill: Exclude<AcademySkill, "map">, name: string): string {
  switch (skill) {
    case "flag":
      return "Name this flag's country";
    case "shape":
      return "Name the country with this outline";
    case "capital":
      return `Type the capital of ${name}`;
  }
}

/** The answer label for a country under a skill: capitals for the capital skill, names otherwise. */
export function answerLabel(index: CountryIndex, code: CountryCode, skill: AcademySkill): string {
  const country = countryOf(index, code);
  if (!country) return code;
  return skill === "capital" ? country.capital : country.name;
}

const CORRECT_LINES = ["Nice one!", "Spot on!", "Nailed it!", "Exactly right!", "You got it!", "Brilliant!", "Great eye!", "That's the one!", "Lovely!"];
const STREAK_LINES = ["in a row!", "in a row — superb!", "straight — keep going!", "in a row — you're on fire!"];
const MISS_LINES = ["Not quite — that's okay.", "Close, but not this time.", "Tricky one!", "Good try!", "Almost!", "No worries — here's the answer."];

export function pickLine(lines: readonly string[], random: () => number): string {
  return lines[Math.floor(random() * lines.length) % lines.length] ?? lines[0] ?? "";
}

export function correctHeadline(streak: number, random: () => number): string {
  if (streak >= 3 && streak % 1 === 0 && (streak === 3 || streak % 5 === 0 || random() < 0.35)) return `${streak} ${pickLine(STREAK_LINES, random)}`;
  return pickLine(CORRECT_LINES, random);
}

export function missHeadline(random: () => number): string {
  return pickLine(MISS_LINES, random);
}

/** Lightweight celebration: CSS-animated confetti pieces (hidden under reduced motion). */
export function confetti(count = 28, random: () => number = Math.random): HTMLElement {
  const layer = el("div", { className: "lx-confetti", attrs: { "aria-hidden": "true" } });
  for (let index = 0; index < count; index += 1) {
    const piece = el("span", { className: `lx-confetti-piece is-${index % 5}` });
    piece.style.setProperty("--x", `${Math.round(random() * 100)}%`);
    piece.style.setProperty("--delay", `${Math.round(random() * 500)}ms`);
    piece.style.setProperty("--drift", `${Math.round((random() - 0.5) * 160)}px`);
    piece.style.setProperty("--spin", `${Math.round(random() * 720 - 360)}deg`);
    piece.style.setProperty("--dur", `${Math.round(1500 + random() * 1100)}ms`);
    layer.append(piece);
  }
  return layer;
}

export function visuallyHidden(tag: "p" | "span" = "p", attrs: Record<string, string> = {}): HTMLElement {
  return el(tag, { className: "lx-sr-only", attrs });
}
