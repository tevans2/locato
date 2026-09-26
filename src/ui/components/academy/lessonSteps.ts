import { checkTypedAnswer, groupForCountry, type AcademySkill } from "../../../core/academy";
import type { CountryCode, CountryIndex } from "../../../core/countries";
import { el } from "../../dom/createElement";
import type { LessonMap } from "./lessonMap";
import {
  answerLabel,
  choicePromptTitle,
  countryName,
  countryOf,
  flagImage,
  icon,
  outlineImage,
  skillLabel,
  typePromptTitle,
} from "./lessonMedia";

/**
 * Step renderers shared by the lesson player and the placement quiz. Each renderer builds the
 * prompt + answer surface for one step and reports a single `StepAnswer`; the screen owns the
 * session, progress recording and feedback tray.
 */

export interface StepAnswer {
  readonly correct: boolean;
  /** The country the player chose (choice / place). */
  readonly pickedCode?: CountryCode;
  readonly typed?: string;
  /** Accepted despite a typo. */
  readonly near?: boolean;
  /** The display spelling of the answer. */
  readonly canonical?: string;
  /** "I don't know". */
  readonly gaveUp?: boolean;
  /** Found on the map after a hint. */
  readonly hinted?: boolean;
}

export interface StepContext {
  readonly countryIndex: CountryIndex;
  readonly map: LessonMap;
  readonly random: () => number;
  /** This is a re-queued, easier copy of a step the player missed. */
  readonly retry?: boolean;
  readonly onAnswer: (answer: StepAnswer) => void;
  readonly onOpenCountry?: (code: CountryCode) => void;
  /** Screen-reader announcement (feedback tray owns the main live region). */
  readonly announce?: (message: string) => void;
  /** Extra footer button, e.g. placement's "Not sure". */
  readonly skipLabel?: string;
}

export interface StepView {
  readonly element: HTMLElement;
  readonly footer: HTMLElement;
  /** Called once the element is in the document (maps need a size to frame). */
  readonly mounted: () => void;
  readonly focus: () => void;
  /** Returns true when the key was handled. */
  readonly handleKey: (event: KeyboardEvent) => boolean;
  readonly reveal: (answer: StepAnswer, correctCode: CountryCode) => void;
  readonly destroy: () => void;
}

// ---------------------------------------------------------------------------------------------
// Country profiles are ~250 KB, so they're loaded lazily and only used for extra flavour.

type ProfileModule = typeof import("../../../core/countries/profiles");
let profileModule: Promise<ProfileModule | null> | null = null;

export function loadCountryProfiles(): Promise<ProfileModule | null> {
  profileModule ??= import("../../../core/countries/profiles").catch(() => null);
  return profileModule;
}

export interface CountryFlavour {
  readonly hook: string | null;
  readonly flagNote: string | null;
}

let loadedProfiles: ProfileModule | null = null;
void loadCountryProfiles().then((module) => {
  loadedProfiles = module;
});

/** Synchronous best effort: null until the profile module has loaded. */
export function countryFlavour(code: CountryCode): CountryFlavour | null {
  try {
    const profile = loadedProfiles?.getCountryProfile(code);
    return profile ? { hook: profile.hook || null, flagNote: profile.flagNote || null } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------

function stepHead(kicker: string, title: string, retry: boolean, extra?: Node): { head: HTMLElement; title: HTMLHeadingElement } {
  const heading = el("h2", { className: "lx-step-title", text: title, attrs: { tabindex: "-1" } });
  const kick = el("p", {
    className: "lx-kicker",
    children: [
      el("span", { className: "lx-kicker-skill", text: kicker }),
      ...(retry ? [el("span", { className: "lx-kicker-retry", children: [icon("retry"), document.createTextNode("Second chance")] })] : []),
    ],
  });
  return { head: el("header", { className: "lx-step-head", children: [kick, heading, ...(extra ? [extra] : [])] }), title: heading };
}

function focusQuietly(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

/** Prompt media for a skill: flag, outline, capital card or the highlighted map. */
function promptMedia(ctx: StepContext, code: CountryCode, skill: AcademySkill): { media: HTMLElement; mount: () => void } {
  const country = countryOf(ctx.countryIndex, code);
  if (skill === "flag") {
    return { media: el("figure", { className: "lx-media lx-media-flag", children: [flagImage(country, "lx-flag lx-flag-hero")] }), mount: () => undefined };
  }
  if (skill === "shape") {
    return { media: el("figure", { className: "lx-media lx-media-shape", children: [outlineImage(code, "lx-outline lx-outline-hero")] }), mount: () => undefined };
  }
  if (skill === "capital") {
    return {
      media: el("figure", {
        className: "lx-media lx-media-capital",
        children: [flagImage(country, "lx-flag lx-flag-capital", true), el("figcaption", { className: "lx-capital-country", text: country?.name ?? code })],
      }),
      mount: () => undefined,
    };
  }
  const figure = el("figure", { className: "lx-media lx-media-map" });
  return {
    media: figure,
    mount: () => {
      figure.append(ctx.map.element);
      ctx.map.setMode("static");
      ctx.map.onCountryClick = null;
      ctx.map.setHitAreas([], null);
      ctx.map.clearHint();
      ctx.map.clearTones();
      ctx.map.showLabel(null);
      ctx.map.setTone(code, "target");
      ctx.map.frameCountry(code, { pad: 4.2, minWidth: 80 });
    },
  };
}

function footerRow(...children: Node[]): HTMLElement {
  return el("div", { className: "lx-footer-row", children });
}

function primaryButton(text: string, className = ""): HTMLButtonElement {
  return el("button", { className: `lx-btn lx-btn-primary ${className}`.trim(), text, attrs: { type: "button" } });
}

function secondaryButton(text: string, className = ""): HTMLButtonElement {
  return el("button", { className: `lx-btn lx-btn-ghost ${className}`.trim(), text, attrs: { type: "button" } });
}

// ---------------------------------------------------------------------------------------------
// Meet

export function createMeetStep(code: CountryCode, ctx: StepContext & { readonly position?: string }): StepView {
  const country = countryOf(ctx.countryIndex, code);
  const name = country?.name ?? code;
  const heading = el("h2", { className: "lx-meet-name", text: name, attrs: { tabindex: "-1" } });
  const mapFigure = el("figure", { className: "lx-meet-card lx-meet-map", children: [el("figcaption", { text: "Where it is" })] });
  const hook = el("p", { className: "lx-meet-hook" });
  hook.hidden = true;

  const more = el("button", {
    className: "lx-link",
    attrs: { type: "button" },
    children: [document.createTextNode(`More about ${name}`), icon("arrow")],
    on: { click: () => ctx.onOpenCountry?.(code) },
  });
  if (!ctx.onOpenCountry) more.hidden = true;

  const element = el("article", {
    className: "lx-step lx-meet",
    attrs: { "data-step-kind": "meet", "data-code": code },
    children: [
      el("p", {
        className: "lx-kicker",
        children: [
          el("span", { className: "lx-badge-new", children: [icon("spark"), document.createTextNode("New country")] }),
          ...(ctx.position ? [el("span", { className: "lx-kicker-meta", text: ctx.position })] : []),
        ],
      }),
      heading,
      el("div", {
        className: "lx-meet-grid",
        children: [
          el("figure", { className: "lx-meet-card lx-meet-flag", children: [flagImage(country, "lx-flag lx-flag-meet"), el("figcaption", { text: "Flag" })] }),
          el("figure", { className: "lx-meet-card lx-meet-shape", children: [outlineImage(code, "lx-outline lx-outline-meet"), el("figcaption", { text: "Outline" })] }),
          mapFigure,
        ],
      }),
      el("dl", {
        className: "lx-meet-facts",
        children: [
          el("div", { children: [el("dt", { text: "Capital" }), el("dd", { text: country?.capital ?? "—" })] }),
          el("div", { children: [el("dt", { text: "Continent" }), el("dd", { text: country?.geographyLabel ?? country?.continent ?? "—" })] }),
        ],
      }),
      hook,
      more,
    ],
  });

  let done = false;
  const gotIt = primaryButton("Got it", "lx-got-it");
  const finish = (): void => {
    if (done) return;
    done = true;
    ctx.onAnswer({ correct: true });
  };
  gotIt.addEventListener("click", finish);

  let cancelled = false;
  void loadCountryProfiles().then((module) => {
    if (cancelled || !module) return;
    const profile = module.getCountryProfile(code);
    if (profile?.hook) {
      hook.textContent = profile.hook;
      hook.hidden = false;
    }
  });

  return {
    element,
    footer: footerRow(gotIt),
    mounted: () => {
      mapFigure.prepend(ctx.map.element);
      ctx.map.setMode("static");
      ctx.map.onCountryClick = null;
      ctx.map.setHitAreas([], null);
      ctx.map.clearHint();
      ctx.map.clearTones();
      ctx.map.showLabel(null);
      ctx.map.setTone(code, "target");
      const group = groupForCountry(code);
      // Start on the region, then glide in: shows where the country sits before the close-up.
      ctx.map.frameCountries(group ? group.countryCodes : [code], { pad: 1.6, minWidth: 110 });
      ctx.map.frameCountry(code, { animate: true, pad: 3.4, minWidth: 60 });
    },
    focus: () => focusQuietly(gotIt),
    handleKey: (event) => {
      if (event.key !== "Enter") return false;
      finish();
      return true;
    },
    reveal: () => undefined,
    destroy: () => {
      cancelled = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Choice

export interface ChoiceInput {
  readonly code: CountryCode;
  readonly skill: AcademySkill;
  readonly options: readonly CountryCode[];
}

export function createChoiceStep(input: ChoiceInput, ctx: StepContext): StepView {
  const { code, skill } = input;
  const name = countryName(ctx.countryIndex, code);
  const { head, title } = stepHead(skillLabel(skill), choicePromptTitle(skill, name), !!ctx.retry);
  const { media, mount } = promptMedia(ctx, code, skill);
  let answered = false;

  const buttons = input.options.map((option, index) =>
    el("button", {
      className: "lx-option",
      attrs: { type: "button", "data-code": option, "aria-keyshortcuts": String(index + 1) },
      children: [
        el("span", { className: "lx-key", text: String(index + 1), attrs: { "aria-hidden": "true" } }),
        el("span", { className: "lx-option-label", text: answerLabel(ctx.countryIndex, option, skill) }),
        el("span", { className: "lx-option-mark", attrs: { "aria-hidden": "true" } }),
      ],
      on: { click: () => pick(option) },
    }),
  );

  function pick(option: CountryCode): void {
    if (answered) return;
    answered = true;
    ctx.onAnswer({ correct: option === code, pickedCode: option, canonical: answerLabel(ctx.countryIndex, code, skill) });
  }

  const skip = ctx.skipLabel ? secondaryButton(ctx.skipLabel, "lx-skip") : null;
  skip?.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    ctx.onAnswer({ correct: false, gaveUp: true, canonical: answerLabel(ctx.countryIndex, code, skill) });
  });

  const element = el("section", {
    className: `lx-step lx-choice is-${skill} has-${input.options.length}-options`,
    attrs: { "data-step-kind": "choice", "data-code": code, "data-skill": skill },
    children: [
      head,
      media,
      el("div", { className: "lx-options", attrs: { role: "group", "aria-label": "Answer options" }, children: buttons }),
    ],
  });

  const hint = el("p", { className: "lx-key-hint", text: `Press 1–${input.options.length} to answer` });

  return {
    element,
    footer: footerRow(...(skip ? [skip] : []), hint),
    mounted: mount,
    focus: () => focusQuietly(title),
    handleKey: (event) => {
      const number = Number(event.key);
      if (!Number.isInteger(number) || number < 1 || number > buttons.length) return false;
      buttons[number - 1]?.click();
      return true;
    },
    reveal: (answer, correctCode) => {
      answered = true;
      for (const button of buttons) {
        const option = button.dataset.code;
        button.disabled = true;
        button.classList.toggle("is-answer", option === correctCode);
        button.classList.toggle("is-picked", option === answer.pickedCode);
        if (option === answer.pickedCode) button.setAttribute("aria-pressed", "true");
        if (option === correctCode || option === answer.pickedCode) {
          button.querySelector(".lx-option-mark")?.replaceChildren(icon(option === correctCode ? "check" : "nudge"));
        }
      }
      element.classList.add(answer.correct ? "is-correct" : "is-missed");
      if (skill === "map" && answer.pickedCode && answer.pickedCode !== correctCode) {
        ctx.map.setTone(correctCode, "good");
        ctx.map.setTone(answer.pickedCode, "picked");
        ctx.map.frameCountries([correctCode, answer.pickedCode], { animate: true, pad: 1.6, minWidth: 80 });
      } else if (skill === "map") {
        ctx.map.setTone(correctCode, "good");
      }
    },
    destroy: () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Type

export interface TypeInput {
  readonly code: CountryCode;
  readonly skill: Exclude<AcademySkill, "map">;
  readonly scaffold: "first-letter" | "length" | "none";
}

let inputId = 0;

export function createTypeStep(input: TypeInput, ctx: StepContext): StepView {
  const { code, skill, scaffold } = input;
  const country = countryOf(ctx.countryIndex, code);
  const name = country?.name ?? code;
  const answer = answerLabel(ctx.countryIndex, code, skill);
  const { head } = stepHead(skillLabel(skill), typePromptTitle(skill, name), !!ctx.retry);
  const { media, mount } = promptMedia(ctx, code, skill);
  const id = `lx-type-${(inputId += 1)}`;
  const firstLetter = answer.trim().charAt(0).toLocaleUpperCase();

  const field = el("input", {
    className: "lx-type-input",
    attrs: {
      id,
      type: "text",
      autocomplete: "off",
      autocapitalize: "words",
      autocorrect: "off",
      spellcheck: "false",
      enterkeyhint: "done",
      placeholder: scaffold === "none" ? (skill === "capital" ? "Type the capital" : "Type the country") : `${firstLetter}…`,
    },
  });

  const slots = scaffold === "length" ? letterSlots(answer) : null;
  const hintText =
    scaffold === "first-letter"
      ? `Starts with “${firstLetter}”`
      : scaffold === "length"
        ? `${answer.replace(/[^\p{L}]/gu, "").length} letters`
        : "Spelling doesn't need to be perfect";
  const hint = el("p", { className: "lx-type-hint", text: hintText });

  const check = primaryButton("Check", "lx-check");
  check.disabled = true;
  const dontKnow = secondaryButton(ctx.skipLabel ?? "I don't know", "lx-dont-know");
  let answered = false;

  const form = el("form", {
    className: `lx-type-form is-${scaffold}`,
    attrs: { novalidate: "" },
    children: [
      el("label", { className: "lx-sr-only", text: skill === "capital" ? `Capital of ${name}` : "Country name", attrs: { for: id } }),
      el("div", { className: "lx-type-field", children: [field, el("span", { className: "lx-type-mark", attrs: { "aria-hidden": "true" } })] }),
      ...(slots ? [slots.element] : []),
      hint,
    ],
  });

  function submit(): void {
    if (answered) return;
    const value = field.value.trim();
    if (!value) {
      field.focus();
      return;
    }
    const result = checkTypedAnswer(ctx.countryIndex, code, skill, value);
    answered = true;
    ctx.onAnswer({ correct: result.correct, near: result.near, typed: value, canonical: result.canonical || answer });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  field.addEventListener("input", () => {
    check.disabled = field.value.trim().length === 0;
    slots?.update(field.value);
  });
  check.addEventListener("click", submit);
  dontKnow.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    ctx.onAnswer({ correct: false, gaveUp: true, canonical: answer, typed: field.value.trim() });
  });

  const element = el("section", {
    className: `lx-step lx-type is-${skill}`,
    attrs: { "data-step-kind": "type", "data-code": code, "data-skill": skill, "data-scaffold": scaffold },
    children: [head, media, form],
  });

  return {
    element,
    footer: footerRow(dontKnow, check),
    mounted: mount,
    focus: () => {
      field.focus({ preventScroll: true });
    },
    handleKey: () => false,
    reveal: (result) => {
      answered = true;
      field.readOnly = true;
      check.disabled = true;
      dontKnow.disabled = true;
      form.classList.add(result.correct ? "is-correct" : "is-missed");
      form.querySelector(".lx-type-mark")?.replaceChildren(icon(result.correct ? "check" : "nudge"));
      if (result.correct && result.canonical) field.value = result.canonical;
      else if (!result.correct) slots?.update(answer);
      if (field === document.activeElement && window.matchMedia?.("(hover: none)").matches) field.blur();
    },
    destroy: () => undefined,
  };
}

function letterSlots(answer: string): { element: HTMLElement; update: (value: string) => void } {
  const element = el("div", { className: "lx-slots", attrs: { "aria-hidden": "true" } });
  const cells: HTMLElement[] = [];
  for (const char of answer) {
    if (/\p{L}/u.test(char)) {
      const cell = el("span", { className: "lx-slot" });
      cells.push(cell);
      element.append(cell);
    } else element.append(el("span", { className: "lx-slot-gap", text: char === " " ? "" : char }));
  }
  return {
    element,
    update: (value) => {
      const letters = [...value.replace(/[^\p{L}]/gu, "")];
      cells.forEach((cell, index) => {
        cell.textContent = letters[index]?.toLocaleUpperCase() ?? "";
        cell.classList.toggle("is-filled", index < letters.length);
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Place

export function createPlaceStep(code: CountryCode, ctx: StepContext): StepView {
  const name = countryName(ctx.countryIndex, code);
  const { head, title } = stepHead("Map", `Find ${name}`, !!ctx.retry, el("p", { className: "lx-step-sub", text: "Tap the country. Drag or zoom to explore." }));
  const figure = el("figure", { className: "lx-media lx-media-map is-place" });
  const dontKnow = secondaryButton(ctx.skipLabel ?? "I don't know", "lx-dont-know");
  let misses = 0;
  let answered = false;
  let pickedTimer: ReturnType<typeof setTimeout> | null = null;

  const answerWith = (answer: StepAnswer): void => {
    if (answered) return;
    answered = true;
    ctx.map.onCountryClick = null;
    ctx.onAnswer(answer);
  };

  function onClick(clicked: CountryCode): void {
    if (answered) return;
    if (clicked === code) {
      answerWith({ correct: true, hinted: misses > 0, pickedCode: clicked, canonical: name });
      return;
    }
    if (misses === 0) {
      misses = 1;
      const clickedName = countryName(ctx.countryIndex, clicked);
      ctx.map.setTone(clicked, "picked");
      if (pickedTimer) clearTimeout(pickedTimer);
      pickedTimer = setTimeout(() => {
        if (!answered) ctx.map.setTone(clicked, null);
      }, 1100);
      ctx.map.showHint(code, ctx.random);
      ctx.map.showLabel(`That's ${clickedName}. Try inside the circle.`, "warm");
      ctx.announce?.(`That's ${clickedName}. Hint: look inside the circle.`);
      element.classList.add("has-hint");
      return;
    }
    answerWith({ correct: false, pickedCode: clicked, canonical: name });
  }

  dontKnow.addEventListener("click", () => answerWith({ correct: false, gaveUp: true, canonical: name }));

  const element = el("section", {
    className: "lx-step lx-place",
    attrs: { "data-step-kind": "place", "data-code": code, "data-skill": "map" },
    children: [head, figure],
  });

  return {
    element,
    footer: footerRow(dontKnow),
    mounted: () => {
      figure.append(ctx.map.element);
      ctx.map.clearTones();
      ctx.map.clearHint();
      ctx.map.showLabel(null);
      ctx.map.setMode("interactive");
      ctx.map.onCountryClick = onClick;
      ctx.map.setHitAreas(ctx.countryIndex.countries.map((country) => country.code), code);
      const group = groupForCountry(code);
      ctx.map.frameCountries(group ? group.countryCodes : [code], { pad: 1.7, minWidth: 110 });
    },
    focus: () => focusQuietly(title),
    handleKey: () => false,
    reveal: (answer, correctCode) => {
      answered = true;
      if (pickedTimer) clearTimeout(pickedTimer);
      ctx.map.onCountryClick = null;
      ctx.map.setMode("static");
      ctx.map.clearHint();
      ctx.map.clearTones();
      ctx.map.setTone(correctCode, "good");
      dontKnow.disabled = true;
      if (answer.pickedCode && answer.pickedCode !== correctCode) {
        ctx.map.setTone(answer.pickedCode, "picked");
        ctx.map.frameCountries([correctCode, answer.pickedCode], { animate: true, pad: 1.8, minWidth: 70 });
      } else {
        ctx.map.frameCountry(correctCode, { animate: true, pad: 3.4, minWidth: 60 });
      }
      ctx.map.showLabel(name);
      element.classList.add(answer.correct ? "is-correct" : "is-missed");
    },
    destroy: () => {
      if (pickedTimer) clearTimeout(pickedTimer);
      ctx.map.onCountryClick = null;
      ctx.map.setHitAreas([], null);
    },
  };
}
