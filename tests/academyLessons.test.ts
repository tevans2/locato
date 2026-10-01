import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createSeededRandom } from "../src/core/game";
import {
  ACADEMY_SKILLS,
  answerStep,
  buildLesson,
  buildLookalikeDrill,
  buildMistakesLesson,
  buildReviewLesson,
  createLessonSession,
  currentStep,
  easierStep,
  emptyProgress,
  findGroup,
  isSessionComplete,
  LEARNING_GROUPS,
  LOOKALIKES,
  LESSON_MAX_STEPS,
  pickDistractors,
  promotedStep,
  recordAnswer,
  recordLessonAttempt,
  seedCard,
  stepForCard,
  type AcademyProgress,
  type Lesson,
  type LessonStep,
  type LeitnerBox,
} from "../src/core/academy";

const index = indexCountries(rawCountries);
const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;

function allBoxes(progress: AcademyProgress, codes: readonly string[], box: LeitnerBox): AcademyProgress {
  let next = progress;
  for (const code of codes) for (const skill of ACADEMY_SKILLS) next = seedCard(next, code, skill, box, NOW - 30 * DAY);
  return next;
}

function optionsOf(step: LessonStep | undefined): readonly string[] {
  return step?.kind === "choice" ? step.options : [];
}

function assertValidOptions(steps: readonly LessonStep[]) {
  for (const step of steps) {
    if (step.kind !== "choice") continue;
    expect(step.options).toContain(step.code);
    expect(new Set(step.options).size).toBe(step.options.length);
    expect(step.options.length).toBeGreaterThanOrEqual(2);
    expect(step.options.length).toBeLessThanOrEqual(4);
  }
}

function noBackToBack(steps: readonly LessonStep[]) {
  const graded = steps.filter((step) => step.kind !== "meet");
  const repeats = graded.filter((step, position) => position > 0 && graded[position - 1]!.code === step.code).length;
  expect(repeats).toBe(0);
}

describe("buildLesson", () => {
  it("introduces new countries then interleaves easy choices", () => {
    const group = findGroup("europe-big-names")!;
    const lesson = buildLesson(group, emptyProgress(), index, NOW, createSeededRandom("fresh"));
    expect(lesson.id).toBe(group.id);
    expect(lesson.steps.length).toBeGreaterThanOrEqual(12);
    expect(lesson.steps.length).toBeLessThanOrEqual(20);
    const meets = lesson.steps.filter((step) => step.kind === "meet");
    expect(meets).toHaveLength(3);
    expect(lesson.steps.slice(0, 3).every((step) => step.kind === "meet")).toBe(true);
    const graded = lesson.steps.slice(3);
    expect(graded.every((step) => step.kind === "choice" && step.options.length === 2)).toBe(true);
    expect(new Set(graded.map((step) => step.code))).toEqual(new Set(meets.map((step) => step.code)));
    assertValidOptions(lesson.steps);
    noBackToBack(lesson.steps);
  });

  it("stays within 12–20 steps for every group and progress level", () => {
    for (const box of [0, 1, 3, 5] as const) {
      for (const group of LEARNING_GROUPS) {
        const progress = box === 0 ? emptyProgress() : allBoxes(emptyProgress(), group.countryCodes, box);
        const lesson = buildLesson(group, progress, index, NOW, createSeededRandom(`${group.id}-${box}`));
        expect(lesson.steps.length, `${group.id}@${box}`).toBeGreaterThanOrEqual(12);
        expect(lesson.steps.length, `${group.id}@${box}`).toBeLessThanOrEqual(20);
        assertValidOptions(lesson.steps);
        noBackToBack(lesson.steps);
      }
    }
  });

  it("climbs the ladder with the card box", () => {
    const random = createSeededRandom("ladder");
    expect(stepForCard("FR", "flag", 0, index, random)).toMatchObject({ kind: "choice", options: expect.arrayContaining(["FR"]) });
    expect(optionsOf(stepForCard("FR", "flag", 1, index, random))).toHaveLength(3);
    expect(optionsOf(stepForCard("FR", "flag", 2, index, random))).toHaveLength(4);
    expect(stepForCard("FR", "capital", 3, index, random)).toEqual({ kind: "type", code: "FR", skill: "capital", scaffold: "first-letter" });
    expect(stepForCard("FR", "shape", 5, index, random)).toEqual({ kind: "type", code: "FR", skill: "shape", scaffold: "none" });
    expect(stepForCard("FR", "map", 1, index, random).kind).toBe("choice");
    expect(stepForCard("FR", "map", 2, index, random)).toEqual({ kind: "place", code: "FR" });
  });

  it("mixes in weak seen cards alongside new countries", () => {
    const group = findGroup("heart-of-europe")!;
    let progress = allBoxes(emptyProgress(), ["PL", "CZ"], 3);
    progress = recordAnswer(progress, "PL", "capital", false, NOW - DAY, "2026-09-25");
    const lesson = buildLesson(group, progress, index, NOW, createSeededRandom("mixed"));
    const meets = lesson.steps.filter((step) => step.kind === "meet").map((step) => step.code);
    expect(meets).not.toContain("PL");
    expect(meets).toHaveLength(3);
    expect(lesson.steps.some((step) => step.kind === "choice" && step.code === "PL" && step.skill === "capital")).toBe(true);
    expect(lesson.steps.some((step) => step.kind === "type")).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const group = findGroup("the-stans")!;
    const build = () => buildLesson(group, emptyProgress(), index, NOW, createSeededRandom("same"));
    expect(build()).toEqual(build());
  });
});

describe("distractors", () => {
  it("prefer lookalikes, then the group, then the continent", () => {
    const random = createSeededRandom("d");
    expect(pickDistractors("TD", "flag", 1, index, random)).toEqual(["RO"]);
    const guinea = pickDistractors("GN", "map", 2, index, random);
    expect(new Set(guinea)).toEqual(new Set(["GW", "GQ"]));
    const group = findGroup("sahel")!;
    const sahel = pickDistractors("BF", "shape", 3, index, random, group.countryCodes);
    expect(sahel.every((code) => group.countryCodes.includes(code))).toBe(true);
    const many = pickDistractors("BF", "shape", 10, index, random, group.countryCodes);
    expect(many.every((code) => index.byCode.get(code)?.continent === "Africa")).toBe(true);
    expect(many).not.toContain("BF");
  });
});

describe("lesson session", () => {
  const lesson: Lesson = {
    id: "t",
    title: "t",
    steps: [
      { kind: "meet", code: "FR" },
      { kind: "type", code: "FR", skill: "capital", scaffold: "none" },
      { kind: "choice", code: "DE", skill: "flag", options: ["DE", "BE", "AT", "NL"] },
      { kind: "place", code: "IT" },
      { kind: "choice", code: "ES", skill: "flag", options: ["ES", "PT"] },
      { kind: "choice", code: "GR", skill: "flag", options: ["GR", "FI"] },
    ],
  };

  it("re-queues a miss three steps later in easier form, once", () => {
    let session = createLessonSession(lesson);
    session = answerStep(session, false); // meet ignores correctness
    expect(session.total).toBe(0);
    session = answerStep(session, false, (step) => easierStep(step, index, createSeededRandom("e")));
    expect(session.queue).toHaveLength(7);
    const retry = session.queue[5]!;
    expect(retry.retry).toBe(true);
    expect(retry.step).toMatchObject({ kind: "choice", code: "FR", skill: "capital" });
    expect(optionsOf(retry.step)).toHaveLength(3);

    session = answerStep(session, true);
    session = answerStep(session, true);
    session = answerStep(session, true);
    expect(currentStep(session)?.retry).toBe(true);
    session = answerStep(session, false);
    expect(session.queue).toHaveLength(7);
    session = answerStep(session, true);
    expect(isSessionComplete(session)).toBe(true);
    expect(session.correct).toBe(4);
    expect(session.total).toBe(5);
    expect(session.attempts.map((attempt) => attempt.retry)).toEqual([false, false, false, false, true, false]);
  });

  it("appends near the end and simplifies without an index", () => {
    let session = createLessonSession(lesson);
    for (let step = 0; step < 4; step += 1) session = answerStep(session, true);
    session = answerStep(session, false);
    expect(session.queue.at(-1)).toMatchObject({ retry: true, step: { code: "ES", options: ["ES", "PT"] } });
    session = createLessonSession(lesson);
    session = answerStep(answerStep(answerStep(session, true), true), false);
    expect(optionsOf(session.queue[6]!.step)).toHaveLength(3);
  });

  it("records first attempts only", () => {
    let session = createLessonSession(lesson);
    session = answerStep(answerStep(session, true), false);
    let progress = emptyProgress();
    for (const attempt of session.attempts) progress = recordLessonAttempt(progress, attempt, NOW, "2026-09-26");
    expect(progress.cards["FR:capital"]).toMatchObject({ box: 1, wrong: 1 });
    const retry = recordLessonAttempt(progress, { code: "FR", skill: "capital", correct: true, retry: true }, NOW, "2026-09-26");
    expect(retry).toBe(progress);
  });
});

describe("in-lesson promotion", () => {
  it("marks new countries' flag/shape/capital choices to graduate, leaving room in the lesson", () => {
    const group = findGroup("europe-big-names")!;
    const lesson = buildLesson(group, emptyProgress(), index, NOW, createSeededRandom("fresh"));
    const promotable = lesson.steps.filter((step) => step.kind === "choice" && step.promote);
    expect(promotable.length).toBeGreaterThanOrEqual(3);
    expect(promotable.every((step) => step.kind === "choice" && step.skill !== "map")).toBe(true);
    expect(lesson.steps.length).toBeLessThanOrEqual(LESSON_MAX_STEPS - 3);
  });

  it("does not mark review cards of seen countries", () => {
    const group = findGroup("europe-big-names")!;
    const lesson = buildLesson(group, allBoxes(emptyProgress(), group.countryCodes, 1), index, NOW, createSeededRandom("seen"));
    expect(lesson.steps.some((step) => step.kind === "choice" && step.promote)).toBe(false);
  });

  it("queues a letter-count typing step a few steps after a correct choice, never next to the same country", () => {
    const group = findGroup("europe-big-names")!;
    const lesson = buildLesson(group, emptyProgress(), index, NOW, createSeededRandom("fresh"));
    let session = createLessonSession(lesson);
    while (!isSessionComplete(session)) session = answerStep(session, true);
    const promoted = session.queue.filter((entry) => entry.promoted);
    expect(promoted.length).toBeGreaterThan(0);
    expect(promoted.every((entry) => entry.step.kind === "type" && entry.step.scaffold === "length")).toBe(true);
    expect(session.queue.length).toBeLessThanOrEqual(LESSON_MAX_STEPS);
    expect(session.queue.length).toBeGreaterThanOrEqual(12);
    noBackToBack(session.queue.map((entry) => entry.step));
    // Promoted steps count toward the score but reach spaced repetition only once per card.
    expect(session.total).toBe(session.attempts.length);
    let progress = emptyProgress();
    for (const attempt of session.attempts) progress = recordLessonAttempt(progress, attempt, NOW, "2026-09-26");
    const answered = Object.values(progress.cards).reduce((sum, card) => sum + card.correct + card.wrong, 0);
    expect(answered).toBe(session.attempts.length - promoted.length);
  });

  it("does not promote misses, retries or promoted steps, and respects the step cap", () => {
    const steps: LessonStep[] = [
      { kind: "choice", code: "FR", skill: "flag", options: ["FR", "IT"], promote: true },
      { kind: "choice", code: "DE", skill: "map", options: ["DE", "PL"], promote: true },
      { kind: "choice", code: "ES", skill: "capital", options: ["ES", "PT"], promote: true },
    ];
    let session = createLessonSession({ id: "t", title: "t", steps });
    session = answerStep(session, false); // FR missed: retry, no promotion
    session = answerStep(session, true); // DE map: promoted to placing
    expect(session.queue.map((entry) => [entry.step.kind, entry.step.code, !!entry.retry, !!entry.promoted])).toEqual([
      ["choice", "FR", false, false],
      ["choice", "DE", false, false],
      ["choice", "ES", false, false],
      ["choice", "FR", true, false],
      ["place", "DE", false, true],
    ]);
    session = answerStep(session, true); // ES capital
    session = answerStep(session, true); // FR retry: never promoted
    expect(session.queue.filter((entry) => entry.promoted)).toHaveLength(2);
    session = answerStep(session, false); // promoted place missed: not re-queued
    expect(session.queue).toHaveLength(6);
    while (!isSessionComplete(session)) session = answerStep(session, true);
    expect(session.queue).toHaveLength(6);

    const capped = answerStep(createLessonSession({ id: "t", title: "t", steps }, 3), true);
    expect(capped.queue).toHaveLength(3);
  });

  it("maps a choice to its recall rung", () => {
    expect(promotedStep({ kind: "choice", code: "FR", skill: "capital", options: ["FR", "IT"] })).toEqual({ kind: "type", code: "FR", skill: "capital", scaffold: "length" });
    expect(promotedStep({ kind: "choice", code: "FR", skill: "map", options: ["FR", "IT"] })).toEqual({ kind: "place", code: "FR" });
    expect(promotedStep({ kind: "place", code: "FR" })).toBeNull();
  });
});

describe("mistakes lesson", () => {
  it("drills each missed card once as a fresh 3-option choice that can graduate", () => {
    const attempts = [
      { code: "FR", skill: "capital" as const, correct: false, retry: false },
      { code: "DE", skill: "flag" as const, correct: true, retry: false },
      { code: "FR", skill: "capital" as const, correct: false, retry: true },
      { code: "IT", skill: "map" as const, correct: false, retry: false },
      { code: "FR", skill: "flag" as const, correct: false, retry: false },
    ];
    const lesson = buildMistakesLesson(attempts, index, createSeededRandom("m"));
    expect(lesson.id).toBe("mistakes");
    expect(lesson.steps.map((step) => [step.code, step.kind === "meet" ? null : step.kind === "place" ? "map" : step.skill])).toEqual([
      ["FR", "capital"],
      ["IT", "map"],
      ["FR", "flag"],
    ]);
    expect(lesson.steps.every((step) => step.kind === "choice" && step.options.length === 3 && step.promote)).toBe(true);
    assertValidOptions(lesson.steps);
  });

  it("stays short and records a correct answer on a just-missed card normally", () => {
    const many = LEARNING_GROUPS[0]!.countryCodes.flatMap((code) => ACADEMY_SKILLS.map((skill) => ({ code, skill, correct: false })));
    expect(buildMistakesLesson(many, index, createSeededRandom("m")).steps.length).toBeLessThanOrEqual(8);

    let progress = recordAnswer(emptyProgress(), "FR", "capital", false, NOW - 60_000, "2026-09-26");
    expect(progress.cards["FR:capital"]).toMatchObject({ box: 1 });
    let session = createLessonSession(buildMistakesLesson([{ code: "FR", skill: "capital" }], index, createSeededRandom("m")));
    while (!isSessionComplete(session)) session = answerStep(session, true);
    expect(session.queue.map((entry) => entry.step.kind)).toEqual(["choice", "type"]);
    for (const attempt of session.attempts) progress = recordLessonAttempt(progress, attempt, NOW, "2026-09-26");
    expect(progress.cards["FR:capital"]).toMatchObject({ box: 2, correct: 1, wrong: 1 });
  });
});

describe("review and lookalike drills", () => {
  it("builds reviews from due cards across groups", () => {
    let progress = emptyProgress();
    for (const code of ["FR", "JP", "BR", "KE"]) progress = recordAnswer(progress, code, "flag", true, NOW - DAY, "2026-09-25");
    progress = recordAnswer(progress, "FR", "map", true, NOW - DAY, "2026-09-25");
    const review = buildReviewLesson(progress, index, NOW, createSeededRandom("r"));
    expect(review.id).toBe("review");
    expect(review.steps).toHaveLength(5);
    noBackToBack(review.steps);
    assertValidOptions(review.steps);
    expect(buildReviewLesson(progress, index, NOW, createSeededRandom("r"), 2).steps).toHaveLength(2);
    expect(buildReviewLesson(emptyProgress(), index, NOW, createSeededRandom("r")).steps).toEqual([]);
  });

  it("drills a set with options drawn from the set", () => {
    const nordic = LOOKALIKES.find((set) => set.codes.includes("DK") && set.skill === "flag")!;
    const drill = buildLookalikeDrill(nordic, index, createSeededRandom("n"));
    expect(drill.id).toBe("lookalikes");
    expect(drill.steps).toHaveLength(10);
    assertValidOptions(drill.steps);
    for (const step of drill.steps) {
      if (step.kind === "choice") expect(step.options.every((code) => nordic.codes.includes(code))).toBe(true);
    }
    const byCode = buildLookalikeDrill("SK", index, createSeededRandom("sk"));
    expect(byCode.steps.length).toBeGreaterThan(4);
    expect(buildLookalikeDrill("BR", index, createSeededRandom("x")).steps).toEqual([]);
  });
});
