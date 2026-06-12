import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { getCategory } from "../src/core/categories";
import { createGameEngine, getCurrentCountry, TOTAL_HINTS } from "../src/core/game";

const fixtureCountries = [
  { name: "Japan", code: "JP", aliases: ["Nippon"], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: ["Brasil"], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg", capital: "Ottawa", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

function createFixtureGame(seed = "test-seed") {
  const countryIndex = indexCountries(fixtureCountries);
  const engine = createGameEngine({ countryIndex, categoryIds: ["flags"], seed, now: 1000 });
  return { countryIndex, engine };
}

describe("game engine", () => {
  it("accepts a correct answer and advances state", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState());

    expect(current).not.toBeNull();
    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: current!.name, now: 1100 });
    const state = engine.getState();

    expect(events[0]?.type).toBe("GUESS_CORRECT");
    expect(state.correctAnswers).toBe(1);
    expect(state.attempts).toBe(1);
    expect(state.streak).toBe(1);
    expect(state.guessedCountryIds.has(current!.id)).toBe(true);
  });

  it("does not count partial auto-submit input as wrong attempts", () => {
    const { engine } = createFixtureGame();

    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: "not the full name", now: 1050, auto: true });
    const state = engine.getState();

    expect(events).toEqual([]);
    expect(state.attempts).toBe(0);
    expect(state.wrongAnswers).toBe(0);
  });

  it("ignores empty submitted guesses without affecting attempts or streak", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState());

    engine.dispatch({ type: "SUBMIT_GUESS", value: current!.name, now: 1040 });
    const streakState = engine.getState();
    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: "   ", now: 1050 });
    const state = engine.getState();

    expect(events).toEqual([]);
    expect(state.attempts).toBe(streakState.attempts);
    expect(state.wrongAnswers).toBe(streakState.wrongAnswers);
    expect(state.streak).toBe(streakState.streak);
  });

  it("returns a country fact before the direct name-shape hint", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState());

    const firstHint = engine.dispatch({ type: "REQUEST_HINT", now: 1060 })[0];
    const secondHint = engine.dispatch({ type: "REQUEST_HINT", now: 1070 })[0];

    expect(firstHint?.type).toBe("HINT_REVEALED");
    expect(secondHint?.type).toBe("HINT_REVEALED");
    if (firstHint?.type !== "HINT_REVEALED" || secondHint?.type !== "HINT_REVEALED") return;
    expect(firstHint.hint.title).toBe("Country note");
    expect(secondHint.hint.title).toBe("Name shape");
    expect(firstHint.hint.message).not.toContain(current!.name);
    expect(secondHint.hint.message).toContain(`Starts with “${current!.name.charAt(0).toUpperCase()}”`);
    expect(secondHint.hint.message).toContain(`${current!.name.replace(/[^A-Za-z]/g, "").length} letters`);
    expect(engine.getState().hintLevel).toBe(2);
  });

  it("accepts punctuation-heavy abbreviations and close misspellings on submit", () => {
    const countryIndex = indexCountries([
      { name: "United States", code: "US", aliases: ["USA"], continent: "North America", flagSrc: "assets/flags/us.svg", capital: "Washington D.C.", capitalAliases: ["Washington", "Washington DC"] },
    ] as const satisfies readonly RawCountry[]);
    const engine = createGameEngine({ countryIndex, categoryIds: ["flags"], seed: "abbr", now: 1000 });

    expect(engine.dispatch({ type: "SUBMIT_GUESS", value: "U.S.A.", now: 1100 })[0]?.type).toBe("GUESS_CORRECT");

    const typoEngine = createGameEngine({ countryIndex, categoryIds: ["flags"], seed: "abbr", now: 1000 });
    expect(typoEngine.dispatch({ type: "SUBMIT_GUESS", value: "Untied States", now: 1100 })[0]?.type).toBe("GUESS_CORRECT");
  });

  it("keeps the prompt live after a wrong answer", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState());

    engine.dispatch({ type: "SUBMIT_GUESS", value: "wrong", now: 1100 });
    const state = engine.getState();

    expect(state.currentCountryId).toBe(current!.id);
    expect(state.wrongAnswers).toBe(1);
    expect(state.attempts).toBe(1);
    expect(state.streak).toBe(0);
  });

  it("skips without counting an attempt and allows the skipped country to return", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState());

    engine.dispatch({ type: "SKIP_ROUND", now: 1100 });
    const state = engine.getState();

    expect(state.attempts).toBe(0);
    expect(state.skippedCountryIds.has(current!.id)).toBe(true);
    expect(state.queue.remainingCountryIds).toContain(current!.id);
  });

  it("uses deterministic round order for a seed", () => {
    const first = createFixtureGame("same-seed").engine.getState().currentCountryId;
    const second = createFixtureGame("same-seed").engine.getState().currentCountryId;

    expect(first).toBe(second);
  });

  it("can play only a supplied country pool", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const poolCountryIds = [countryIndex.byCode.get("JP")!.id, countryIndex.byCode.get("CA")!.id];
    const engine = createGameEngine({ countryIndex, categoryIds: ["flags"], seed: "fixed-pool", poolCountryIds, now: 1000 });

    expect(engine.getState().poolCountryIds).toEqual(poolCountryIds);

    while (engine.getState().status === "playing") {
      const current = getCurrentCountry(countryIndex, engine.getState());
      if (!current) break;
      engine.dispatch({ type: "SUBMIT_GUESS", value: current.name, now: 1200 });
    }

    expect(engine.getState().correctAnswers).toBe(2);
    expect(engine.getState().status).toBe("complete");
  });

  it("emits completion after all countries are guessed", () => {
    const { countryIndex, engine } = createFixtureGame();
    const observedEvents: string[] = [];

    while (engine.getState().status === "playing") {
      const current = getCurrentCountry(countryIndex, engine.getState());
      if (!current) break;
      observedEvents.push(...engine.dispatch({ type: "SUBMIT_GUESS", value: current.name, now: 1200 }).map((event) => event.type));
    }

    expect(engine.getState().status).toBe("complete");
    expect(observedEvents).toContain("GAME_COMPLETED");
  });

  it("plays a code-prompt category answered by country name", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const engine = createGameEngine({ countryIndex, categoryIds: ["codes"], seed: "codes", now: 1000 });

    expect(engine.getState().currentCategoryId).toBe("codes");
    const current = getCurrentCountry(countryIndex, engine.getState());
    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: current!.name, now: 1100 });

    expect(events[0]?.type).toBe("GUESS_CORRECT");
  });

  it("plays a country-outline category answered by country name", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const engine = createGameEngine({ countryIndex, categoryIds: ["shapes"], seed: "shapes", now: 1000 });

    expect(engine.getState().currentCategoryId).toBe("shapes");
    const current = getCurrentCountry(countryIndex, engine.getState());
    const category = getCategory("shapes");
    expect(category?.prompt(current!).value).toBe(`assets/country-shapes/${current!.code.toLowerCase()}.svg`);
    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: current!.name, now: 1100 });

    expect(events[0]?.type).toBe("GUESS_CORRECT");
  });

  it("mixes only the selected categories across the deck", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const engine = createGameEngine({ countryIndex, categoryIds: ["flags", "shapes", "codes"], seed: "mix", now: 1000 });
    const seenCategories = new Set<string>();

    while (engine.getState().status === "playing") {
      const state = engine.getState();
      if (state.currentCategoryId) seenCategories.add(state.currentCategoryId);
      const current = getCurrentCountry(countryIndex, state);
      if (!current) break;
      engine.dispatch({ type: "SUBMIT_GUESS", value: current.name, now: 1200 });
    }

    expect(engine.getState().status).toBe("complete");
    for (const categoryId of seenCategories) expect(["flags", "shapes", "codes"]).toContain(categoryId);
  });

  it("reveals the answer and resolves the round after all hints are exhausted", () => {
    const { countryIndex, engine } = createFixtureGame();
    const current = getCurrentCountry(countryIndex, engine.getState())!;
    for (let i = 0; i < TOTAL_HINTS; i += 1) engine.dispatch({ type: "REQUEST_HINT", now: 1010 + i });
    expect(engine.getState().hintLevel).toBe(TOTAL_HINTS);

    const events = engine.dispatch({ type: "REVEAL_ANSWER", now: 1100 });
    const state = engine.getState();

    expect(events.some((event) => event.type === "ANSWER_REVEALED")).toBe(true);
    expect(state.guessedCountryIds.has(current.id)).toBe(true);
    expect(state.correctAnswers).toBe(0);
    expect(state.streak).toBe(0);
    expect(state.currentCountryId).not.toBe(current.id);
  });
});
