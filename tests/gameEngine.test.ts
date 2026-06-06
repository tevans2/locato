import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createGameEngine, getCurrentCountry } from "../src/core/game";
import { classicMode, streakMode } from "../src/core/modes";

const fixtureCountries = [
  { name: "Japan", code: "JP", aliases: ["Nippon"], continent: "Asia", flagSrc: "assets/flags/jp.svg" },
  { name: "Brazil", code: "BR", aliases: ["Brasil"], continent: "South America", flagSrc: "assets/flags/br.svg" },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg" },
] as const satisfies readonly RawCountry[];

function createFixtureGame(seed = "test-seed") {
  const countryIndex = indexCountries(fixtureCountries);
  const engine = createGameEngine({ countryIndex, mode: classicMode, seed, now: 1000 });
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
      { name: "United States", code: "US", aliases: ["USA"], continent: "North America", flagSrc: "assets/flags/us.svg" },
    ] as const satisfies readonly RawCountry[]);
    const engine = createGameEngine({ countryIndex, mode: classicMode, seed: "abbr", now: 1000 });

    expect(engine.dispatch({ type: "SUBMIT_GUESS", value: "U.S.A.", now: 1100 })[0]?.type).toBe("GUESS_CORRECT");

    const typoEngine = createGameEngine({ countryIndex, mode: classicMode, seed: "abbr", now: 1000 });
    expect(typoEngine.dispatch({ type: "SUBMIT_GUESS", value: "Untied States", now: 1100 })[0]?.type).toBe("GUESS_CORRECT");
  });

  it("expires timed mode when the clock reaches zero", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const engine = createGameEngine({ countryIndex, mode: { ...classicMode, id: "timed-test", durationSeconds: 1 }, seed: "timer", now: 1000 });

    expect(engine.getState().timeRemainingMs).toBe(1000);
    const events = engine.dispatch({ type: "TICK", now: 2000 });

    expect(events.map((event) => event.type)).toEqual(["TIMER_EXPIRED", "GAME_COMPLETED"]);
    expect(engine.getState().status).toBe("complete");
    expect(engine.getState().timeRemainingMs).toBe(0);
  });

  it("keeps the flag live after a wrong answer", () => {
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

  it("ends streak mode after one wrong answer", () => {
    const countryIndex = indexCountries(fixtureCountries);
    const engine = createGameEngine({ countryIndex, mode: streakMode, seed: "streak", now: 1000 });

    const events = engine.dispatch({ type: "SUBMIT_GUESS", value: "wrong", now: 1100 });

    expect(engine.getState().status).toBe("complete");
    expect(events.map((event) => event.type)).toContain("GAME_COMPLETED");
  });
});
