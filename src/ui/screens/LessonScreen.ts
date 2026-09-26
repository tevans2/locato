import type { Screen } from "../../app/router";
import type { AcademyProgressStore } from "../../app/academyProgress";
import type { CountryCode, CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import {
  academyLevel,
  answerStep,
  buildLesson,
  buildLookalikeDrill,
  buildMistakesLesson,
  buildReviewLesson,
  cardKey,
  createLessonSession,
  currentStep,
  easierStep,
  findGroup,
  groupCompletion,
  groupForCountry,
  recordLessonAttempt,
  stepSkill,
  suggestNextGroup,
  toDayKey,
  type AcademyProgress,
  type AcademySkill,
  type LearningGroup,
  type Lesson,
  type LessonAttempt,
  type LessonSession,
  type LessonStep,
  type SessionStep,
} from "../../core/academy";
import { createRandomSeed, createSeededRandom } from "../../core/game/random";
import { el } from "../dom/createElement";
import { bindKeyboardAwareInput } from "../dom/mobileKeyboard";
import { playCorrect, playRoundTaken, playVictory } from "../dom/sfx";
import { createCompletionView, createLessonTopBar, createMessageView, type CompletionAction } from "../components/academy/lessonChrome";
import { createFeedbackTray, missDetails, type FeedbackContent } from "../components/academy/lessonFeedback";
import { createLessonMap, type LessonMap } from "../components/academy/lessonMap";
import { answerLabel, correctHeadline, countryName, missHeadline } from "../components/academy/lessonMedia";
import {
  createChoiceStep,
  createMeetStep,
  createPlaceStep,
  createTypeStep,
  type StepAnswer,
  type StepContext,
  type StepView,
} from "../components/academy/lessonSteps";
import "../../styles/academy-lesson.css";

export interface LessonScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly progressStore: AcademyProgressStore;
  /** Group id, "review", or "lookalikes:<CODE>". */
  readonly lessonId: string;
  /** Back to the Academy hub, optionally opening a group's panel. */
  readonly onExit: (groupId?: string) => void;
  readonly onStartLesson: (lessonId: string) => void;
  readonly onOpenCountry: (code: string) => void;
  /** Deterministic randomness for tests; defaults to a fresh random seed. */
  readonly random?: () => number;
  /** Clock override for tests. */
  readonly now?: () => number;
}

type LessonKind = "group" | "review" | "lookalikes" | "practice";

interface ResolvedLesson {
  readonly kind: LessonKind;
  readonly lesson: Lesson;
  readonly group: LearningGroup | null;
  /** Group whose hub panel "Back" should open. */
  readonly exitGroupId: string | undefined;
  readonly lookalikeCode?: CountryCode;
}

function resolveLesson(
  lessonId: string,
  progress: AcademyProgress,
  index: CountryIndex,
  now: number,
  random: () => number,
): ResolvedLesson | null {
  if (lessonId === "review") {
    return { kind: "review", lesson: buildReviewLesson(progress, index, now, random), group: null, exitGroupId: undefined };
  }
  if (lessonId.startsWith("lookalikes:")) {
    const code = lessonId.slice("lookalikes:".length).toUpperCase();
    if (!index.byCode.has(code)) return null;
    const lesson = buildLookalikeDrill(code, index, random);
    const title = `${countryName(index, code)} lookalikes`;
    return { kind: "lookalikes", lesson: { ...lesson, title }, group: null, exitGroupId: groupForCountry(code)?.id, lookalikeCode: code };
  }
  const group = findGroup(lessonId);
  if (!group) return null;
  return { kind: "group", lesson: buildLesson(group, progress, index, now, random), group, exitGroupId: group.id };
}

export function createLessonScreen(options: LessonScreenOptions): Screen {
  const { countryIndex, progressStore } = options;
  const random = options.random ?? createSeededRandom(createRandomSeed());
  const now = options.now ?? (() => Date.now());
  const abort = new AbortController();
  const root = el("section", { className: "lx lesson-screen", attrs: { "data-phase": "loading", "aria-label": "Academy lesson" } });
  const announcer = el("p", { className: "lx-sr-only", attrs: { "aria-live": "polite" } });

  const startProgress = progressStore.get();
  const resolved = resolveLesson(options.lessonId, startProgress, countryIndex, now(), random);
  const exit = (): void => options.onExit(resolved?.exitGroupId);

  // ------------------------------------------------------------------------------------------
  // Friendly dead ends.

  function showMessage(phase: string, view: HTMLElement, title = "Academy"): void {
    root.dataset.phase = phase;
    const top = createLessonTopBar({ title, exitLabel: "Back to Academy", onExit: exit });
    root.replaceChildren(top.element, el("main", { className: "lx-stage is-centered", children: [el("div", { className: "lx-stage-inner", children: [view] })] }), announcer);
    view.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  if (!resolved) {
    showMessage(
      "not-found",
      createMessageView({
        tone: "lost",
        kicker: "Lesson not found",
        title: "We couldn't find that lesson",
        body: "It may have moved, or the link is incomplete. Your progress is safe — pick a lesson from the Academy.",
        actions: [{ label: "Back to Academy", run: () => options.onExit(), primary: true }],
      }),
    );
    return { element: root, destroy: () => abort.abort() };
  }

  if (resolved.lesson.steps.length === 0) {
    const suggestion = suggestNextGroup(startProgress);
    const actions: (CompletionAction & { primary?: boolean })[] = [];
    if (resolved.kind === "review" && suggestion) actions.push({ label: `Learn: ${suggestion.title}`, run: () => options.onStartLesson(suggestion.id), primary: true });
    actions.push({ label: "Back to Academy", run: exit, primary: actions.length === 0 });
    showMessage(
      "empty",
      resolved.kind === "review"
        ? createMessageView({
            tone: "done",
            kicker: "Review",
            title: "All caught up!",
            body: "Nothing is due for review right now. Cards come back just before you'd forget them — check in again later, or learn something new.",
            actions,
          })
        : createMessageView({
            tone: "calm",
            kicker: "Lookalikes",
            title: "No lookalikes here",
            body: `${resolved.lookalikeCode ? countryName(countryIndex, resolved.lookalikeCode) : "This country"} doesn't have any known lookalikes to drill. Nice and distinctive!`,
            actions,
          }),
      resolved.lesson.title,
    );
    return { element: root, destroy: () => abort.abort() };
  }

  // ------------------------------------------------------------------------------------------
  // The player.

  const map: LessonMap = createLessonMap(options.worldCountryFeatures, countryIndex);
  const ease = (step: LessonStep): LessonStep => easierStep(step, countryIndex, random);
  let kind: LessonKind = resolved.kind;
  let lesson: Lesson = resolved.lesson;
  let session: LessonSession = createLessonSession(lesson);
  let phase: "step" | "feedback" | "complete" = "step";
  let stepView: StepView | null = null;
  let stepAbort: AbortController | null = null;
  let streak = 0;
  let bestStreak = 0;
  /** Distinct cards missed on a first try this round (retries and repeats excluded). */
  const missedCards = (): LessonAttempt[] => {
    const seen = new Set<string>();
    return session.attempts.filter((attempt) => {
      const key = cardKey(attempt.code, attempt.skill);
      if (attempt.correct || attempt.retry || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  let meetTotal = lesson.steps.filter((step) => step.kind === "meet").length;
  let meetSeen = 0;

  let top = createLessonTopBar({ title: lesson.title, onExit: exit });
  const stageInner = el("div", { className: "lx-stage-inner" });
  const stage = el("main", { className: "lx-stage", children: [stageInner] });
  const footerInner = el("div", { className: "lx-footer-inner" });
  const footer = el("footer", { className: "lx-footer", children: [footerInner] });
  const tray = createFeedbackTray({ onContinue: () => advance(), onOpenCountry: options.onOpenCountry });

  function layoutPlayer(): void {
    root.replaceChildren(top.element, stage, footer, tray.element, announcer);
  }

  const announce = (message: string): void => {
    announcer.textContent = "";
    announcer.textContent = message;
  };

  function renderStep(current: SessionStep): StepView {
    const ctx: StepContext = {
      countryIndex,
      map,
      random,
      retry: current.retry,
      promoted: current.promoted === true,
      onAnswer: (answer) => handleAnswer(current, answer),
      onOpenCountry: options.onOpenCountry,
      announce,
    };
    const step = current.step;
    switch (step.kind) {
      case "meet":
        meetSeen += 1;
        return createMeetStep(step.code, { ...ctx, ...(meetTotal > 1 ? { position: `${meetSeen} of ${meetTotal}` } : {}) });
      case "choice":
        return createChoiceStep(step, ctx);
      case "type":
        return createTypeStep(step, ctx);
      case "place": {
        if (map.hasCountry(step.code)) return createPlaceStep(step.code, ctx);
        // No map shape for this country: ask it as a multiple choice instead.
        const fallback = ease(step);
        return fallback.kind === "choice" ? createChoiceStep(fallback, ctx) : createPlaceStep(step.code, ctx);
      }
    }
  }

  function showStep(): void {
    const current = currentStep(session);
    stepView?.destroy();
    stepAbort?.abort();
    stepView = null;
    if (!current) {
      finish();
      return;
    }
    phase = "step";
    root.dataset.phase = "step";
    root.dataset.stepKind = current.step.kind;
    root.dataset.retry = String(current.retry);
    stepAbort = new AbortController();
    const view = renderStep(current);
    stepView = view;
    view.element.classList.add("is-entering");
    stageInner.replaceChildren(view.element);
    footerInner.replaceChildren(view.footer);
    stage.scrollTop = 0;
    top.setProgress(session.position, session.queue.length);
    const input = view.element.querySelector<HTMLInputElement>("input.lx-type-input");
    if (input) bindKeyboardAwareInput(root, input, stepAbort.signal);
    else root.classList.remove("is-mobile-typing", "has-virtual-keyboard");
    map.setInsetBottom(0);
    view.mounted();
    view.focus();
  }

  /** Keep a revealed map answer visible above the feedback tray. */
  function fitMapAboveTray(): void {
    if (!map.element.isConnected) return;
    const mapRect = map.element.getBoundingClientRect();
    // Measure the tray's resting position (it is mid slide-in animation right now).
    const trayTop = root.getBoundingClientRect().bottom - tray.element.offsetHeight;
    const overlap = mapRect.bottom - trayTop;
    if (mapRect.height <= 0 || overlap <= 0) return;
    map.setInsetBottom(overlap);
    map.reframe(true);
  }

  function feedbackFor(current: SessionStep, answer: StepAnswer, skill: AcademySkill): FeedbackContent {
    const step = current.step;
    const name = countryName(countryIndex, step.code);
    const more = { moreCode: step.code, moreLabel: `More about ${name}` };
    if (answer.correct) {
      const detail = answer.near
        ? `Close enough — it's spelled “${answer.canonical ?? name}”.`
        : answer.hinted
          ? `Found ${name} with a hint — nice recovery.`
          : current.retry
            ? `Got it this time — ${skill === "capital" ? `${answerLabel(countryIndex, step.code, skill)} is the capital of ${name}` : name}.`
            : skill === "capital"
              ? `${answerLabel(countryIndex, step.code, skill)} is the capital of ${name}.`
              : step.kind === "place"
                ? `That's ${name}, right where it belongs.`
                : `That's ${name}.`;
      return { tone: "good", headline: answer.near ? "Correct!" : correctHeadline(streak, random), detail, ...more };
    }
    return {
      tone: "warm",
      headline: answer.gaveUp ? "Here's the answer" : missHeadline(random),
      detail: current.promoted
        ? "You picked it out earlier — recalling it from scratch takes a few goes."
        : current.retry || kind === "practice"
          ? "No stress — it'll come round again in a review."
          : "We'll try this one again in a moment.",
      ...missDetails(countryIndex, step, skill, answer),
      ...more,
    };
  }

  function handleAnswer(current: SessionStep, answer: StepAnswer): void {
    if (phase !== "step" || currentStep(session) !== current) return;
    const step = current.step;
    const skill = stepSkill(step);
    if (skill === null) {
      session = answerStep(session, true, ease);
      showStep();
      return;
    }

    phase = "feedback";
    root.dataset.phase = "feedback";
    session = answerStep(session, answer.correct, ease);
    const attempt = session.attempts.at(-1);
    // Every round is real practice, mistakes review included: a first answer per card reaches spaced repetition.
    if (attempt) {
      const time = now();
      progressStore.update((progress) => recordLessonAttempt(progress, attempt, time, toDayKey(time)));
    }

    streak = answer.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    stepView?.reveal(answer, step.code);
    top.setProgress(session.position, session.queue.length);
    top.setStreak(streak);
    if (answer.correct) playCorrect();
    else playRoundTaken();
    tray.show(feedbackFor(current, answer, skill));
    root.classList.toggle("is-tray-warm", !answer.correct);
    tray.focus();
    fitMapAboveTray();
  }

  function advance(): void {
    if (phase !== "feedback") return;
    tray.hide();
    showStep();
  }

  function startPractice(): void {
    kind = "practice";
    lesson = buildMistakesLesson(missedCards(), countryIndex, random);
    session = createLessonSession(lesson);
    streak = 0;
    bestStreak = 0;
    meetTotal = 0;
    meetSeen = 0;
    top = createLessonTopBar({ title: lesson.title, onExit: exit });
    layoutPlayer();
    showStep();
  }

  function finish(): void {
    phase = "complete";
    root.dataset.phase = "complete";
    delete root.dataset.stepKind;
    tray.hide();
    const progress = progressStore.get();
    const codes = [...new Set(session.queue.map((entry) => entry.step.code))];
    const newCodes = [...new Set(lesson.steps.filter((step) => step.kind === "meet").map((step) => step.code))];
    const group = kind === "group" ? resolved!.group : null;
    const suggestion = suggestNextGroup(progress);
    const missed = missedCards();

    let primary: CompletionAction | null = null;
    if (group) {
      const after = groupCompletion(progress, group);
      if (!after.completed) primary = { label: "Next lesson", run: () => options.onStartLesson(group.id) };
      else if (suggestion) primary = { label: `Next: ${suggestion.title}`, run: () => options.onStartLesson(suggestion.id) };
    } else if (suggestion) {
      primary = { label: kind === "practice" ? "Keep learning" : `Learn: ${suggestion.title}`, run: () => options.onStartLesson(suggestion.id) };
    }

    const titles: Record<LessonKind, string> = {
      group: "Lesson complete!",
      review: "Review done!",
      lookalikes: "Drill complete!",
      practice: "Mistakes reviewed!",
    };
    const subtitles: Record<LessonKind, string> = {
      group: `${lesson.title}, one step closer.`,
      review: "Those memories just got a little stronger.",
      lookalikes: "Your eye for the details is sharpening.",
      practice: "Those cards are back on track in your review schedule.",
    };

    const view = createCompletionView({
      title: titles[kind],
      subtitle: subtitles[kind],
      correct: session.correct,
      total: session.total,
      bestStreak,
      newCodes,
      practicedCodes: codes,
      group,
      groupBefore: group ? groupCompletion(startProgress, group) : null,
      groupAfter: group ? groupCompletion(progress, group) : null,
      levelBefore: academyLevel(startProgress),
      levelAfter: academyLevel(progress),
      primary,
      review: missed.length > 0 ? { label: `Review mistakes (${missed.length})`, run: startPractice } : null,
      back: { label: "Back to Academy", run: exit },
      onOpenCountry: options.onOpenCountry,
      countryIndex,
      random,
    });
    top.setProgress(1, 1);
    stageInner.replaceChildren(view);
    footerInner.replaceChildren();
    root.replaceChildren(top.element, stage, announcer);
    stage.scrollTop = 0;
    playVictory();
    view.querySelector<HTMLElement>(".lx-done-title")?.focus({ preventScroll: true });
    announce(`${titles[kind]} ${session.correct} of ${session.total} correct on the first try.`);
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!root.isConnected) return;
      if (phase === "feedback") {
        if (event.key !== "Enter") return;
        const target = event.target;
        if (target instanceof HTMLButtonElement && !target.classList.contains("lx-continue") && root.contains(target)) return;
        event.preventDefault();
        advance();
        return;
      }
      if (phase !== "step" || !stepView) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLButtonElement && event.key === "Enter" && !target.classList.contains("lx-got-it")) return;
      if (stepView.handleKey(event)) event.preventDefault();
    },
    { signal: abort.signal },
  );

  layoutPlayer();
  showStep();

  return {
    element: root,
    destroy: () => {
      abort.abort();
      stepAbort?.abort();
      stepView?.destroy();
      map.destroy();
    },
  };
}

