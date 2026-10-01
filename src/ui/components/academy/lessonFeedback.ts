import { lookalikesFor, type AcademySkill, type LessonStep } from "../../../core/academy";
import type { CountryCode, CountryIndex } from "../../../core/countries";
import { el } from "../../dom/createElement";
import { answerLabel, countryOf, flagImage, icon, outlineImage } from "./lessonMedia";
import { countryFlavour, type StepAnswer } from "./lessonSteps";

/** Duolingo-style bottom sheet shown after every lesson answer. */

export interface CompareCard {
  readonly label: string;
  readonly title: string;
  readonly sub?: string;
  readonly media?: HTMLElement;
  readonly tone: "good" | "warm";
}

export interface FeedbackContent {
  readonly tone: "good" | "warm";
  readonly headline: string;
  readonly detail?: string;
  readonly compare?: readonly CompareCard[];
  readonly tip?: { readonly label: string; readonly text: string };
  readonly moreCode?: CountryCode;
  readonly moreLabel?: string;
}

export interface FeedbackTray {
  readonly element: HTMLElement;
  readonly show: (content: FeedbackContent) => void;
  readonly hide: () => void;
  readonly isOpen: () => boolean;
  readonly focus: () => void;
}

export function createFeedbackTray(options: { readonly onContinue: () => void; readonly onOpenCountry?: (code: CountryCode) => void }): FeedbackTray {
  const badge = el("span", { className: "lx-tray-badge", attrs: { "aria-hidden": "true" } });
  const headline = el("strong", { className: "lx-tray-headline" });
  const detail = el("p", { className: "lx-tray-detail" });
  const compare = el("div", { className: "lx-compare" });
  const tip = el("p", { className: "lx-tip" });
  const more = el("button", { className: "lx-link lx-tray-more", attrs: { type: "button" } });
  const continueButton = el("button", { className: "lx-btn lx-btn-primary lx-continue", text: "Continue", attrs: { type: "button" } });
  const live = el("p", { className: "lx-sr-only", attrs: { "aria-live": "assertive", "aria-atomic": "true" } });
  let moreCode: CountryCode | null = null;
  let open = false;

  more.addEventListener("click", () => {
    if (moreCode) options.onOpenCountry?.(moreCode);
  });
  continueButton.addEventListener("click", () => {
    if (open) options.onContinue();
  });

  const element = el("aside", {
    className: "lx-tray",
    attrs: { "aria-label": "Answer feedback", "data-open": "false" },
    children: [
      el("div", {
        className: "lx-tray-inner",
        children: [
          el("div", {
            className: "lx-tray-main",
            children: [el("div", { className: "lx-tray-head", children: [badge, el("div", { children: [headline, detail] })] }), compare, tip],
          }),
          el("div", { className: "lx-tray-actions", children: [more, continueButton] }),
        ],
      }),
      live,
    ],
  });
  element.hidden = true;

  return {
    element,
    show: (content) => {
      open = true;
      element.hidden = false;
      element.dataset.open = "true";
      element.dataset.tone = content.tone;
      badge.replaceChildren(icon(content.tone === "good" ? "check" : "nudge"));
      headline.textContent = content.headline;
      detail.textContent = content.detail ?? "";
      detail.hidden = !content.detail;
      compare.replaceChildren(
        ...(content.compare ?? []).map((card) =>
          el("div", {
            className: `lx-compare-card is-${card.tone}`,
            children: [
              el("span", { className: "lx-compare-label", text: card.label }),
              ...(card.media ? [el("div", { className: "lx-compare-media", children: [card.media] })] : []),
              el("strong", { className: "lx-compare-title", text: card.title }),
              ...(card.sub ? [el("span", { className: "lx-compare-sub", text: card.sub })] : []),
            ],
          }),
        ),
      );
      compare.hidden = !content.compare?.length;
      compare.classList.toggle("is-pair", (content.compare?.length ?? 0) > 1);
      tip.replaceChildren(...(content.tip ? [el("span", { className: "lx-tip-label", text: content.tip.label }), document.createTextNode(content.tip.text)] : []));
      tip.hidden = !content.tip;
      moreCode = content.moreCode ?? null;
      more.replaceChildren(document.createTextNode(content.moreLabel ?? "Learn more"), icon("arrow"));
      more.hidden = !moreCode || !options.onOpenCountry;
      // Re-trigger the slide-in on every answer.
      element.classList.remove("is-entering");
      void element.offsetWidth;
      element.classList.add("is-entering");
      live.textContent = [content.headline, content.detail, content.compare?.map((card) => `${card.label}: ${card.title}`).join(". "), content.tip?.text]
        .filter(Boolean)
        .join(". ");
    },
    hide: () => {
      open = false;
      element.hidden = true;
      element.dataset.open = "false";
      live.textContent = "";
    },
    isOpen: () => open,
    focus: () => continueButton.focus({ preventScroll: true }),
  };
}

// ---------------------------------------------------------------------------------------------

function mediaFor(index: CountryIndex, code: CountryCode, skill: AcademySkill): HTMLElement | undefined {
  if (skill === "flag") return flagImage(countryOf(index, code), "lx-flag lx-flag-compare", true);
  if (skill === "shape") return outlineImage(code, "lx-outline lx-outline-compare");
  return flagImage(countryOf(index, code), "lx-flag lx-flag-mini", true);
}

function card(index: CountryIndex, code: CountryCode, skill: AcademySkill, label: string, tone: "good" | "warm"): CompareCard {
  const country = countryOf(index, code);
  const media = mediaFor(index, code, skill);
  return {
    label,
    title: answerLabel(index, code, skill),
    ...(skill === "capital" ? { sub: `Capital of ${country?.name ?? code}` } : {}),
    ...(media ? { media } : {}),
    tone,
  };
}

/** Side-by-side "what you picked" vs "the answer" cards plus the best tell-apart tip. */
export function missDetails(
  index: CountryIndex,
  step: LessonStep,
  skill: AcademySkill,
  answer: StepAnswer,
): Pick<FeedbackContent, "compare" | "tip"> {
  const code = step.code;
  const compare: CompareCard[] = [];
  if (answer.pickedCode && answer.pickedCode !== code) {
    compare.push(card(index, answer.pickedCode, skill, step.kind === "place" ? "You tapped" : "You picked", "warm"));
  } else if (answer.typed && !answer.gaveUp) {
    compare.push({ label: "You typed", title: answer.typed, tone: "warm" });
  }
  compare.push(card(index, code, skill, "Answer", "good"));

  const sets = lookalikesFor(code, skill);
  const set = (answer.pickedCode ? sets.find((candidate) => candidate.codes.includes(answer.pickedCode!)) : undefined) ?? sets[0];
  if (set) return { compare, tip: { label: "Tell them apart", text: set.tip } };
  const flavour = countryFlavour(code);
  if (skill === "flag" && flavour?.flagNote) return { compare, tip: { label: "Remember it by", text: flavour.flagNote } };
  if ((skill === "map" || skill === "shape") && flavour?.hook) return { compare, tip: { label: "Remember it by", text: flavour.hook } };
  return { compare };
}
