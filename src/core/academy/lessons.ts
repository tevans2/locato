import { fameTier } from "../countries/fame";
import type { CountryCode, CountryIndex } from "../countries";
import { shuffle } from "../game/random";
import { groupForCountry } from "./groups";
import { lookalikesFor } from "./lookalikes";
import { countryMastery } from "./mastery";
import { dueCards, getCard, recordAnswer } from "./srs";
import {
  ACADEMY_SKILLS,
  type AcademyProgress,
  type AcademySkill,
  type LearningGroup,
  type Lesson,
  type LessonStep,
  type LeitnerBox,
  type LookalikeSet,
} from "./types";

export const LESSON_MIN_STEPS = 12;
export const LESSON_TARGET_STEPS = 18;
export const LESSON_MAX_STEPS = 20;
export const LESSON_MAX_NEW_COUNTRIES = 3;
/** Other steps shown between a miss and its retry. */
export const REQUEUE_GAP = 3;

// Easiest first, so a new country's first ladder rungs are the gentlest.
const SKILL_LADDER: readonly AcademySkill[] = ["flag", "map", "shape", "capital"];

type Random = () => number;

interface CardRef {
  readonly code: CountryCode;
  readonly skill: AcademySkill;
}

/**
 * Wrong options for a question about `code`. Preference: known lookalikes for the skill, then the
 * country's learning group, then its continent, then anywhere — so map/shape questions stay regional.
 */
export function pickDistractors(
  code: CountryCode,
  skill: AcademySkill,
  count: number,
  countryIndex: CountryIndex,
  random: Random,
  groupCodes: readonly CountryCode[] = groupForCountry(code)?.countryCodes ?? [],
): CountryCode[] {
  const answer = countryIndex.byCode.get(code);
  const picked: CountryCode[] = [];
  const seen = new Set<CountryCode>([code]);
  const tiers: readonly (readonly CountryCode[])[] = [
    lookalikesFor(code, skill).flatMap((set) => set.codes),
    groupCodes,
    answer ? countryIndex.countries.filter((country) => country.continent === answer.continent).map((country) => country.code) : [],
    countryIndex.countries.map((country) => country.code),
  ];

  for (const tier of tiers) {
    for (const candidate of shuffle(tier, random)) {
      if (picked.length >= count) return picked;
      if (seen.has(candidate) || !countryIndex.byCode.has(candidate)) continue;
      seen.add(candidate);
      picked.push(candidate);
    }
  }
  return picked;
}

function choiceStep(
  code: CountryCode,
  skill: AcademySkill,
  optionCount: number,
  countryIndex: CountryIndex,
  random: Random,
  groupCodes?: readonly CountryCode[],
): LessonStep {
  const distractors = pickDistractors(code, skill, optionCount - 1, countryIndex, random, groupCodes);
  return { kind: "choice", code, skill, options: shuffle([code, ...distractors], random) };
}

/** The ladder rung for a card at `box`: choice (2→3→4 options), then typed recall, then no scaffold; map switches to placing. */
export function stepForCard(
  code: CountryCode,
  skill: AcademySkill,
  box: LeitnerBox,
  countryIndex: CountryIndex,
  random: Random,
  groupCodes?: readonly CountryCode[],
): LessonStep {
  if (skill === "map") {
    return box >= 2 ? { kind: "place", code } : choiceStep(code, skill, box === 0 ? 2 : 3, countryIndex, random, groupCodes);
  }
  if (box <= 2) return choiceStep(code, skill, box + 2, countryIndex, random, groupCodes);
  return { kind: "type", code, skill, scaffold: box === 3 ? "first-letter" : "none" };
}

/** Round-robin across countries so the same country never appears twice in a row while others remain. */
function interleave(cards: readonly CardRef[]): CardRef[] {
  const queues = new Map<CountryCode, CardRef[]>();
  for (const card of cards) {
    const queue = queues.get(card.code);
    if (queue) queue.push(card);
    else queues.set(card.code, [card]);
  }
  const ordered: CardRef[] = [];
  while (queues.size > 0) {
    for (const [code, queue] of queues) {
      const next = queue.shift();
      if (next) ordered.push(next);
      if (queue.length === 0) queues.delete(code);
    }
  }
  return ordered;
}

export function buildLesson(
  group: LearningGroup,
  progress: AcademyProgress,
  countryIndex: CountryIndex,
  now: number,
  random: Random,
): Lesson {
  const codes = group.countryCodes.filter((code) => countryIndex.byCode.has(code));
  const newCodes = codes
    .filter((code) => countryMastery(progress, code) === "new")
    .map((code, position) => ({ code, position }))
    .sort((left, right) => fameTier(left.code) - fameTier(right.code) || left.position - right.position)
    .map(({ code }) => code);

  const seenCards = codes
    .filter((code) => !newCodes.includes(code))
    .flatMap((code) => ACADEMY_SKILLS.map((skill) => ({ code, skill, card: getCard(progress, code, skill) })))
    .map((entry) => ({ ...entry, due: entry.card.box > 0 && entry.card.dueAt <= now }))
    .sort((left, right) => Number(right.due) - Number(left.due) || left.card.box - right.card.box || left.card.dueAt - right.card.dueAt);

  const introduced: CountryCode[] = newCodes.slice(0, LESSON_MAX_NEW_COUNTRIES);
  const stepCount = (seen: number) => introduced.length * (1 + ACADEMY_SKILLS.length) + seen;

  let seenTaken = 0;
  while (seenTaken < seenCards.length && stepCount(seenTaken) < LESSON_TARGET_STEPS) seenTaken += 1;
  while (stepCount(seenTaken) < LESSON_MIN_STEPS && introduced.length < newCodes.length) {
    introduced.push(newCodes[introduced.length]!);
  }

  const newCards: CardRef[] = introduced.flatMap((code) => SKILL_LADDER.map((skill) => ({ code, skill })));
  const reviewCards: CardRef[] = seenCards.slice(0, seenTaken);
  // New countries lead, seen countries are shuffled in among them.
  const countryOrder = [...introduced, ...shuffle([...new Set(reviewCards.map((card) => card.code))], random)];
  const cardsByCountry = [...newCards, ...reviewCards].sort(
    (left, right) =>
      countryOrder.indexOf(left.code) - countryOrder.indexOf(right.code) ||
      SKILL_LADDER.indexOf(left.skill) - SKILL_LADDER.indexOf(right.skill),
  );

  const cardSteps = interleave(cardsByCountry)
    .slice(0, LESSON_MAX_STEPS - introduced.length)
    .map(({ code, skill }) => stepForCard(code, skill, getCard(progress, code, skill).box, countryIndex, random, codes));

  return {
    id: group.id,
    title: group.title,
    steps: [...introduced.map((code): LessonStep => ({ kind: "meet", code })), ...cardSteps],
  };
}

/** Due cards from any group, most overdue first, interleaved by country. Empty steps when nothing is due. */
export function buildReviewLesson(
  progress: AcademyProgress,
  countryIndex: CountryIndex,
  now: number,
  random: Random,
  limit = 15,
): Lesson {
  const due = dueCards(progress, now)
    .filter(({ code }) => countryIndex.byCode.has(code))
    .slice(0, limit);
  const steps = interleave(due).map(({ code, skill }) =>
    stepForCard(code, skill, getCard(progress, code, skill).box, countryIndex, random),
  );
  return { id: "review", title: "Review", steps };
}

/**
 * Tell-apart drill: every country in the set(s) asked twice, options drawn from the set itself.
 * Pass a country code to drill every lookalike set it belongs to.
 */
export function buildLookalikeDrill(
  target: LookalikeSet | CountryCode,
  countryIndex: CountryIndex,
  random: Random,
  maxSteps = 16,
): Lesson {
  const sets = typeof target === "string" ? lookalikesFor(target) : [target];
  const round = (): LessonStep[] =>
    shuffle(
      sets.flatMap((set) => {
        const codes = set.codes.filter((code) => countryIndex.byCode.has(code));
        if (codes.length < 2) return [];
        return codes.map((code): LessonStep => {
          const others = shuffle(codes.filter((other) => other !== code), random).slice(0, 3);
          return { kind: "choice", code, skill: set.skill, options: shuffle([code, ...others], random) };
        });
      }),
      random,
    );

  const first = round();
  const second = round();
  // Avoid the same question back to back across the round boundary.
  if (second.length > 1 && sameQuestion(first.at(-1), second[0])) second.push(second.shift()!);
  return { id: "lookalikes", title: "Lookalikes", steps: [...first, ...second].slice(0, maxSteps) };
}

function sameQuestion(left: LessonStep | undefined, right: LessonStep | undefined): boolean {
  return !!left && !!right && left.code === right.code && stepSkill(left) === stepSkill(right);
}

export function stepSkill(step: LessonStep): AcademySkill | null {
  if (step.kind === "meet") return null;
  if (step.kind === "place") return "map";
  return step.skill;
}

// Lesson session: a pure queue that re-asks missed steps a little later in easier form.

export interface SessionStep {
  readonly step: LessonStep;
  /** True for a re-queued copy of a missed step; retries are never re-queued again. */
  readonly retry: boolean;
}

export interface LessonAttempt {
  readonly code: CountryCode;
  readonly skill: AcademySkill;
  readonly correct: boolean;
  readonly retry: boolean;
}

export interface LessonSession {
  readonly lesson: Lesson;
  readonly queue: readonly SessionStep[];
  readonly position: number;
  /** First-attempt results only; retries don't change the score. */
  readonly correct: number;
  readonly total: number;
  readonly attempts: readonly LessonAttempt[];
}

export function createLessonSession(lesson: Lesson): LessonSession {
  return {
    lesson,
    queue: lesson.steps.map((step) => ({ step, retry: false })),
    position: 0,
    correct: 0,
    total: 0,
    attempts: [],
  };
}

export function currentStep(session: LessonSession): SessionStep | null {
  return session.queue[session.position] ?? null;
}

export function isSessionComplete(session: LessonSession): boolean {
  return session.position >= session.queue.length;
}

/**
 * Index-free easing: fewer choice options, first-letter scaffold for typing. Pass `easierStep`
 * (bound to an index) to `answerStep` to turn typing/placing into a multiple choice instead.
 */
export function simplifyStep(step: LessonStep): LessonStep {
  if (step.kind === "choice" && step.options.length > 2) {
    const kept = step.options.filter((option) => option !== step.code).slice(0, step.options.length - 2);
    const options = step.options.filter((option) => option === step.code || kept.includes(option));
    return { ...step, options };
  }
  if (step.kind === "type" && step.scaffold !== "first-letter") return { ...step, scaffold: "first-letter" };
  return step;
}

/** Retry form for a missed step: type/place become a 3-option choice, choices lose an option. */
export function easierStep(step: LessonStep, countryIndex: CountryIndex, random: Random): LessonStep {
  if (step.kind === "type") return choiceStep(step.code, step.skill, 3, countryIndex, random);
  if (step.kind === "place") return choiceStep(step.code, "map", 3, countryIndex, random);
  return simplifyStep(step);
}

/** Advances past the current step. Meet steps ignore `correct`. A first-time miss is re-queued REQUEUE_GAP steps later. */
export function answerStep(
  session: LessonSession,
  correct: boolean,
  ease: (step: LessonStep) => LessonStep = simplifyStep,
): LessonSession {
  const current = currentStep(session);
  if (!current) return session;
  const skill = stepSkill(current.step);
  const position = session.position + 1;
  if (skill === null) return { ...session, position };

  const attempt: LessonAttempt = { code: current.step.code, skill, correct, retry: current.retry };
  let queue = session.queue;
  if (!correct && !current.retry) {
    const insertAt = Math.min(position + REQUEUE_GAP, queue.length);
    queue = [...queue.slice(0, insertAt), { step: ease(current.step), retry: true }, ...queue.slice(insertAt)];
  }

  return {
    ...session,
    queue,
    position,
    correct: session.correct + (!current.retry && correct ? 1 : 0),
    total: session.total + (current.retry ? 0 : 1),
    attempts: [...session.attempts, attempt],
  };
}

/** Writes one attempt to spaced repetition. Retries are skipped: the first miss already reset the card. */
export function recordLessonAttempt(progress: AcademyProgress, attempt: LessonAttempt, now: number, dayKey: string): AcademyProgress {
  if (attempt.retry) return progress;
  return recordAnswer(progress, attempt.code, attempt.skill, attempt.correct, now, dayKey);
}
