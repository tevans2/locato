import type { Screen } from "../../app/router";
import type { ShellContext } from "../shell/types";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import {
  PLACEMENT_LENGTH,
  applyPlacement,
  createPlacementState,
  findGroup,
  nextPlacementQuestion,
  skipPlacement,
  type PlacementState,
  type PlacementSummary,
} from "../../core/academy";
import { createRandomSeed, createSeededRandom } from "../../core/game/random";
import { el } from "../dom/createElement";
import { playCorrect, playVictory } from "../dom/sfx";
import { createLessonTopBar } from "../components/academy/lessonChrome";
import { createLessonMap, type LessonMap } from "../components/academy/lessonMap";
import { confetti, icon } from "../components/academy/lessonMedia";
import { createChoiceStep, type StepAnswer, type StepView } from "../components/academy/lessonSteps";
import "../../styles/academy-lesson.css";

export interface PlacementScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Placement finished or skipped: go to the hub, opening the suggested group if any. */
  readonly onDone: (suggestedGroupId?: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
  /** Deterministic randomness for tests. */
  readonly random?: () => number;
  readonly now?: () => number;
  /** How long a correct / missed answer stays on screen before the next question (ms). */
  readonly flashMs?: { readonly correct: number; readonly missed: number };
  /** Number of questions; defaults to the engine's 20. */
  readonly length?: number;
}

const DEFAULT_FLASH = { correct: 480, missed: 1150 };

export function createPlacementScreen(options: PlacementScreenOptions): Screen {
  const { countryIndex, progressStore } = options;
  const random = options.random ?? createSeededRandom(createRandomSeed());
  const now = options.now ?? (() => Date.now());
  const flash = options.flashMs ?? DEFAULT_FLASH;
  const length = options.length ?? PLACEMENT_LENGTH;
  const abort = new AbortController();

  const root = el("section", { className: "lx placement-screen", attrs: { "data-shell": "focus", "data-phase": "intro", "aria-label": "Academy placement quiz" } });
  const announcer = el("p", { className: "lx-sr-only", attrs: { "aria-live": "polite" } });
  const top = createLessonTopBar({ title: "Placement", exitLabel: "Leave placement", onExit: () => options.onDone() });
  const stageInner = el("div", { className: "lx-stage-inner" });
  const stage = el("main", { className: "lx-stage", children: [stageInner] });
  const footerInner = el("div", { className: "lx-footer-inner" });
  const footer = el("footer", { className: "lx-footer", children: [footerInner] });

  let map: LessonMap | null = null;
  let state: PlacementState | null = null;
  let view: StepView | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let answering = false;

  const dots = el("ol", { className: "lx-dots", attrs: { "aria-label": "Placement progress" } });
  function renderDots(): void {
    const results = state?.results ?? [];
    dots.replaceChildren(
      ...Array.from({ length }, (_, index) => {
        const result = results[index];
        const status = result ? (result.correct ? "is-good" : "is-warm") : index === results.length ? "is-current" : "";
        return el("li", {
          className: `lx-dot ${status}`.trim(),
          attrs: { "aria-label": result ? `Question ${index + 1}: ${result.correct ? "right" : "missed"}` : `Question ${index + 1}` },
        });
      }),
    );
  }

  // ------------------------------------------------------------------------------------------

  function showIntro(): void {
    root.dataset.phase = "intro";
    const start = el("button", { className: "lx-btn lx-btn-primary lx-placement-start", attrs: { type: "button" }, children: [document.createTextNode("Start placement"), icon("arrow")] });
    const skip = el("button", { className: "lx-btn lx-btn-ghost lx-placement-skip", text: "Skip — I'm a beginner", attrs: { type: "button" } });
    start.addEventListener("click", startQuiz);
    skip.addEventListener("click", () => {
      const time = now();
      progressStore.update((progress) => skipPlacement(progress, time));
      options.onDone();
    });

    const card = el("section", {
      className: "lx-intro",
      children: [
        el("div", { className: "lx-intro-art", attrs: { "aria-hidden": "true" }, children: [icon("compass")] }),
        el("p", { className: "lx-kicker", children: [el("span", { className: "lx-kicker-skill", text: "Placement quiz" })] }),
        el("h2", { className: "lx-intro-title", text: "Let's find your level", attrs: { tabindex: "-1" } }),
        el("p", {
          className: "lx-intro-body",
          text: "A few quick questions on flags, outlines, capitals and the map. It adapts as you go, so you'll skip what you already know.",
        }),
        el("ul", {
          className: "lx-intro-facts",
          children: [
            fact(`${length}`, "quick questions"),
            fact("~2", "minutes"),
            fact("0", "penalties for guessing"),
          ],
        }),
        el("div", { className: "lx-intro-actions", children: [start, skip] }),
      ],
    });
    stageInner.replaceChildren(card);
    footerInner.replaceChildren();
    root.replaceChildren(top.element, stage, announcer);
    stage.classList.add("is-centered");
    card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  function startQuiz(): void {
    map ??= createLessonMap(options.worldCountryFeatures, countryIndex);
    state = createPlacementState(countryIndex, random, length);
    stage.classList.remove("is-centered");
    top.element.querySelector(".lx-top-progress")?.replaceChildren(dots);
    root.replaceChildren(top.element, stage, footer, announcer);
    showQuestion();
  }

  function showQuestion(): void {
    view?.destroy();
    view = null;
    const question = state?.current;
    if (!state || !question || !map) {
      finish();
      return;
    }
    root.dataset.phase = "question";
    root.classList.remove("is-flash-good", "is-flash-warm");
    answering = false;
    renderDots();
    const step = createChoiceStep(
      { code: question.code, skill: question.skill, options: question.options },
      { countryIndex, map, random, onAnswer: (answer) => onAnswer(answer, question.code), skipLabel: "Not sure" },
    );
    view = step;
    step.element.classList.add("is-entering");
    const counter = el("span", { className: "lx-kicker-meta", text: `${state.results.length + 1} of ${length}` });
    step.element.querySelector(".lx-kicker")?.append(counter);
    stageInner.replaceChildren(step.element);
    footerInner.replaceChildren(step.footer);
    stage.scrollTop = 0;
    step.mounted();
    step.focus();
  }

  function onAnswer(answer: StepAnswer, code: string): void {
    if (answering || !state || !view) return;
    answering = true;
    view.reveal(answer, code);
    root.classList.add(answer.correct ? "is-flash-good" : "is-flash-warm");
    if (answer.correct) playCorrect();
    announce(answer.correct ? "Right!" : `The answer was ${answer.canonical ?? ""}.`);
    const correct = answer.correct;
    timer = setTimeout(() => {
      timer = null;
      if (!state) return;
      state = nextPlacementQuestion(state, correct);
      showQuestion();
    }, correct ? flash.correct : flash.missed);
  }

  function finish(): void {
    if (!state) return;
    const results = state.results;
    const time = now();
    let summary: PlacementSummary | null = null;
    progressStore.update((progress) => {
      const applied = applyPlacement(progress, results, time);
      summary = applied.summary;
      return applied.progress;
    });
    showResult(summary ?? applyPlacement(progressStore.get(), results, time).summary);
  }

  function showResult(summary: PlacementSummary): void {
    root.dataset.phase = "result";
    root.classList.remove("is-flash-good", "is-flash-warm");
    renderDots();
    const group = summary.suggestedGroupId ? findGroup(summary.suggestedGroupId) : undefined;
    const actions: HTMLElement[] = [];
    if (group) {
      actions.push(
        el("button", {
          className: "lx-btn lx-btn-primary lx-result-start",
          attrs: { type: "button" },
          children: [document.createTextNode(`Start ${group.title}`), icon("arrow")],
          on: { click: () => options.onStartLesson(group.id) },
        }),
      );
    }
    actions.push(
      el("button", {
        className: `lx-btn ${group ? "lx-btn-ghost" : "lx-btn-primary"} lx-result-academy`,
        text: "Go to Academy",
        attrs: { type: "button" },
        on: { click: () => options.onDone(group?.id) },
      }),
    );

    const tierBlurb: Record<number, string> = {
      0: "A clean slate — the best place to start. We'll introduce countries a few at a time.",
      1: "You know the famous faces. Time to fill in the map around them.",
      2: "You've clearly been around. We'll focus on the regions you're less sure of.",
      3: "Impressive! You know your deep cuts. Lessons will sharpen the trickiest ones.",
    };

    const card = el("section", {
      className: "lx-result",
      children: [
        ...(summary.estimatedTier > 0 ? [confetti(24, random)] : []),
        el("div", { className: "lx-done-seal", attrs: { "aria-hidden": "true" }, children: [icon(summary.estimatedTier > 0 ? "spark" : "compass")] }),
        el("p", { className: "lx-kicker", children: [el("span", { className: "lx-kicker-skill", text: "Your level" })] }),
        el("h2", { className: "lx-result-title", text: summary.label, attrs: { tabindex: "-1" } }),
        el("p", { className: "lx-result-body", text: tierBlurb[summary.estimatedTier] ?? "" }),
        el("div", {
          className: "lx-done-stats",
          children: [
            resultStat(`${summary.correct}/${summary.total}`, "Answered right", "in the quiz"),
            ...(summary.extrapolatedCount > 0
              ? [resultStat(`~${summary.extrapolatedCount}`, "Likely familiar", "pre-filled from your level; reviews will check")]
              : [resultStat(String(summary.testedCorrect), plural(summary.testedCorrect, "Country", "Countries") + " on your map", "from the quiz")]),
          ],
        }),
        ...(group
          ? [
              el("div", {
                className: "lx-result-start-card",
                children: [
                  el("span", { className: "lx-compare-label", text: "We'll start you at" }),
                  el("strong", { text: group.title }),
                  el("span", { className: "lx-compare-sub", text: group.blurb }),
                ],
              }),
            ]
          : []),
        el("div", { className: "lx-done-actions", children: actions }),
      ],
    });
    stageInner.replaceChildren(card);
    footerInner.replaceChildren();
    root.replaceChildren(top.element, stage, announcer);
    stage.classList.add("is-centered");
    playVictory();
    card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    const prefilled = summary.extrapolatedCount > 0 ? ` About ${summary.extrapolatedCount} more countries pre-filled as likely familiar.` : "";
    announce(`Placement complete. ${summary.label}. ${summary.correct} of ${summary.total} right.${prefilled}`);
  }

  function announce(message: string): void {
    announcer.textContent = message;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || !root.isConnected) return;
      if (root.dataset.phase !== "question" || !view || answering) return;
      if (view.handleKey(event)) event.preventDefault();
    },
    { signal: abort.signal },
  );

  showIntro();

  return {
    element: root,
    destroy: () => {
      abort.abort();
      if (timer) clearTimeout(timer);
      view?.destroy();
      map?.destroy();
    },
  };
}

function fact(value: string, label: string): HTMLElement {
  return el("li", { children: [el("strong", { text: value }), el("span", { text: label })] });
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function resultStat(value: string, label: string, note: string): HTMLElement {
  return el("div", {
    className: "lx-stat",
    children: [el("strong", { text: value }), el("span", { className: "lx-stat-label", text: label }), el("span", { className: "lx-stat-note", text: note })],
  });
}
