import type { Country, CountryIndex } from "../../core/countries";
import type { GameCommand, GameEngine, GameEvent, GameState } from "../../core/game";
import { getCategory, type PromptContent } from "../../core/categories";
import { rankedGuessCountry } from "../../core/rankedPresentation";
import type { RankedSession } from "./RankedSession";

/** Local presentation uses practice matchers. The server alone validates and posts the run. */
export function createRankedSoloEngine(index: CountryIndex, session: RankedSession) {
  const byId = [...index.byId];
  const countryIndex: CountryIndex = { ...index, byId };
  const placeholderId = byId.length;
  const pool = index.countries.filter((c) => getCategory(session.mode)?.eligible(c) ?? true);
  let streak = 0, bestStreak = 0, displayScore = 0, correct = 0, skipped = new Set<number>();
  let result: GameState["lastResult"] = null;
  let listener: ((events: readonly GameEvent[]) => void) | null = null;
  let sending = false, generation = 0;
  let pendingCorrect: number | null = null;
  const placeholder: Country = { ...pool[0]!, id: placeholderId, name: "Mystery country", code: "", aliases: [], acceptedAnswers: [], normalizedName: "", capital: "", capitalAliases: [], flagSrc: "" };
  byId[placeholderId] = placeholder;
  function currentId(): number | null {
    if (!session.state.question) return null;
    if (session.mode === "capital-recall") return pool.find((c) => c.name === session.state.question!.text)?.id ?? placeholderId;
    return placeholderId;
  }
  function state(): GameState {
    const server = session.state;
    const found = new Set((server.found ?? []).map((code) => index.byCode.get(code)?.id).filter((id): id is number => id !== undefined));
    if (pendingCorrect !== null) found.add(pendingCorrect);
    return { status: server.status === "complete" ? "complete" : "playing", categoryIds: [session.mode], seed: "server-owned", currentCountryId: currentId(), currentCategoryId: session.mode,
      roundNumber: server.index + 1 + (pendingCorrect !== null ? 1 : 0), guessedCountryIds: found, skippedCountryIds: skipped, attempts: correct + (server.wrongAnswers ?? 0), correctAnswers: correct, wrongAnswers: server.wrongAnswers ?? 0,
      streak, bestStreak, score: displayScore, hintLevel: server.hints ?? 0, startedAt: server.startedAt, endedAt: server.status === "complete" ? (server.startedAt ?? server.serverNow) + server.timeMs! : null,
      lastResult: result, queue: { remainingCountryIds: [] }, poolCountryIds: pool.map((c) => c.id) };
  }
  function award(countryId: number): GameEvent {
    const points = 100 + Math.min(streak, 10) * 10;
    displayScore += points; streak++; correct++; bestStreak = Math.max(streak, bestStreak);
    result = { type: "correct", countryId, message: "Correct." };
    return { type: "GUESS_CORRECT", countryId, nextCountryId: currentId(), points };
  }
  type Counters = { streak: number; bestStreak: number; displayScore: number; correct: number };
  async function send(command: GameCommand, prediction: Country | null, counters: Counters): Promise<void> {
    const version = generation;
    const before = session.state;
    const guessedAlready = pendingCorrect !== null;
    try {
      const next = await session.move(command.type === "SUBMIT_GUESS" ? { type: "answer", answer: command.value, auto: command.auto === true }
        : { type: command.type === "REQUEST_HINT" ? "hint" : command.type === "REVEAL_ANSWER" ? "reveal" : "skip" });
      if (version !== generation || session.signal.aborted) return;
      pendingCorrect = null;
      const detail = next.result;
      if (!detail || detail.questionId !== before.question?.id) throw new Error("Could not verify that move. Please try again.");
      const countryId = detail.countryCode ? index.byCode.get(detail.countryCode)?.id ?? placeholderId : placeholderId;
      const events: GameEvent[] = [];
      if (detail.kind === "correct" && next.index > before.index) {
        if (!guessedAlready) events.push(award(countryId));
        else result = { type: "correct", countryId, message: next.feedback ?? "Correct." };
      } else if (prediction) throw new Error("That answer could not be verified. Please enter it again.");
      else if (command.type === "SUBMIT_GUESS" && !command.auto && (next.wrongAnswers ?? 0) > (before.wrongAnswers ?? 0)) {
        streak = 0; result = { type: "wrong", countryId, message: next.feedback ?? "Try again." }; events.push({ type: "GUESS_WRONG", countryId });
      } else if (command.type === "REQUEST_HINT" && detail.hint) {
        result = { type: "hint", countryId, message: next.feedback! }; events.push({ type: "HINT_REVEALED", countryId, hint: detail.hint });
      } else if (command.type === "SKIP_ROUND" && detail.kind === "skipped") {
        streak = 0; skipped.add(countryId); result = { type: "skipped", countryId, message: next.feedback! }; events.push({ type: "ROUND_SKIPPED", previousCountryId: countryId, nextCountryId: currentId() });
      } else if (command.type === "REVEAL_ANSWER" && detail.kind === "revealed") {
        streak = 0; result = { type: "revealed", countryId, message: next.feedback! }; events.push({ type: "ANSWER_REVEALED", countryId, nextCountryId: currentId() });
      }
      if (next.status === "complete") events.push({ type: "GAME_COMPLETED" });
      listener?.(events);
    } catch (error) {
      if (version !== generation || session.signal.aborted) return;
      pendingCorrect = null;
      if (prediction) {
        ({ streak, bestStreak, displayScore, correct } = counters);
      }
      result = { type: "wrong", countryId: placeholderId, message: (error as Error).message }; listener?.([]);
    } finally { if (version === generation) sending = false; }
  }
  const engine: GameEngine = { getState: state, dispatch(command) {
    if (command.type === "TICK" || command.type === "START_GAME") return [];
    if (command.type === "RESET_GAME") {
      generation++; sending = true; pendingCorrect = null;
      void session.start().then(() => {
        if (session.signal.aborted) return;
        streak = 0; bestStreak = 0; displayScore = 0; correct = 0; skipped = new Set(); result = null; sending = false;
        listener?.([{ type: "GAME_RESET" }]);
      }).catch((error) => { sending = false; result = { type: "wrong", countryId: placeholderId, message: error.message }; listener?.([]); });
      return [];
    }
    if (sending || session.signal.aborted || state().status !== "playing") return [];
    let prediction: Country | null = null;
    if (command.type === "SUBMIT_GUESS") {
      if (!command.value.trim()) return [];
      prediction = rankedGuessCountry(index, session.state.question, session.mode, command.value, command.auto === true);
      if (command.auto && !prediction) return [];
      session.noteGuess();
    }
    sending = true;
    const counters = { streak, bestStreak, displayScore, correct };
    const events: GameEvent[] = [];
    if (prediction) { pendingCorrect = prediction.id; events.push(award(prediction.id)); }
    void send(command, prediction, counters);
    return events;
  } };
  return { engine, countryIndex, subscribe(callback: (events: readonly GameEvent[]) => void) { listener = callback; return () => { generation++; listener = null; }; },
    prompt(): PromptContent | null { const q = session.state.question; return q ? { kind: q.kind === "image" || q.kind === "flag-colors" ? "image" : "text", value: q.asset ?? q.text,
      ...(q.presentation === "shape" || session.mode === "shapes" ? { presentation: "shape" as const } : session.mode === "flag-colors" ? { presentation: "flag-colors" as const } : {}) } : null; } };
}
