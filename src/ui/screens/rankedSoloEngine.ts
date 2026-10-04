import type { Country, CountryIndex } from "../../core/countries";
import type { GameCommand, GameEngine, GameEvent, GameState } from "../../core/game";
import { getCategory, type PromptContent } from "../../core/categories";
import type { RankedSession } from "./RankedSession";

/** A presentation adapter, not a game engine: dispatch always asks the server first. */
export function createRankedSoloEngine(index: CountryIndex, session: RankedSession) {
  const byId = [...index.byId];
  const countryIndex: CountryIndex = { ...index, byId };
  const placeholderId = byId.length;
  const pool = index.countries.filter((c) => getCategory(session.mode)?.eligible(c) ?? true);
  let streak = 0, bestStreak = 0, displayScore = 0, correct = 0, skipped = new Set<number>();
  let result: GameState["lastResult"] = null;
  let listener: ((events: readonly GameEvent[]) => void) | null = null;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
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
    return { status: server.status === "complete" ? "complete" : "playing", categoryIds: [session.mode], seed: "server-owned", currentCountryId: currentId(), currentCategoryId: session.mode,
      roundNumber: server.index + 1, guessedCountryIds: found, skippedCountryIds: skipped, attempts: correct + (server.wrongAnswers ?? 0), correctAnswers: correct, wrongAnswers: server.wrongAnswers ?? 0,
      streak, bestStreak, score: displayScore, hintLevel: server.hints ?? 0, startedAt: server.startedAt, endedAt: server.status === "complete" ? server.startedAt + server.timeMs! : null,
      lastResult: result, queue: { remainingCountryIds: [] }, poolCountryIds: pool.map((c) => c.id) };
  }
  async function send(command: GameCommand): Promise<void> {
    if (sending || session.signal.aborted) return;
    sending = true;
    try {
      if (command.type === "RESET_GAME") {
        await session.start(); streak = 0; bestStreak = 0; displayScore = 0; correct = 0; skipped = new Set(); result = null;
        listener?.([{ type: "GAME_RESET" }]); return;
      }
      const before = session.state;
      const next = await session.move(command.type === "SUBMIT_GUESS" ? { type: "answer", answer: command.value, auto: command.auto === true }
        : { type: command.type === "REQUEST_HINT" ? "hint" : command.type === "REVEAL_ANSWER" ? "reveal" : "skip" });
      const detail = next.result;
      if (!detail || detail.questionId !== before.question?.id) return;
      const countryId = detail.countryCode ? index.byCode.get(detail.countryCode)?.id ?? placeholderId : placeholderId;
      const events: GameEvent[] = [];
      if (detail.kind === "correct" && next.index > before.index) {
        const points = 100 + Math.min(streak, 10) * 10; displayScore += points; streak++; correct++; bestStreak = Math.max(streak, bestStreak);
        result = { type: "correct", countryId, message: next.feedback ?? "Correct." };
        events.push({ type: "GUESS_CORRECT", countryId, nextCountryId: currentId(), points });
      } else if (command.type === "SUBMIT_GUESS" && !command.auto && (next.wrongAnswers ?? 0) > (before.wrongAnswers ?? 0)) {
        streak = 0; result = { type: "wrong", countryId, message: next.feedback ?? "Try again." }; events.push({ type: "GUESS_WRONG", countryId });
      } else if (command.type === "REQUEST_HINT" && detail.hint) {
        result = { type: "hint", countryId, message: next.feedback! }; events.push({ type: "HINT_REVEALED", countryId, hint: detail.hint });
      } else if (command.type === "SKIP_ROUND" && detail.kind === "skipped") {
        streak = 0; skipped.add(countryId); result = { type: "skipped", countryId, message: next.feedback! }; events.push({ type: "ROUND_SKIPPED", previousCountryId: countryId, nextCountryId: currentId() });
      } else if (command.type === "REVEAL_ANSWER" && detail.kind === "revealed") {
        streak = 0; result = { type: "revealed", countryId, message: next.feedback! }; events.push({ type: "ANSWER_REVEALED", countryId, nextCountryId: currentId() });
      }
      if (next.status === "complete") events.push({ type: "GAME_COMPLETED" });
      if (events.length) listener?.(events);
    } catch (error) { result = { type: "wrong", countryId: placeholderId, message: (error as Error).message }; listener?.([]); }
    finally { sending = false; }
  }
  const engine: GameEngine = { getState: state, dispatch(command) {
    if (command.type === "TICK" || command.type === "START_GAME") return [];
    clearTimeout(autoTimer);
    const questionId = session.state.question?.id;
    if (command.type === "SUBMIT_GUESS" && command.auto) autoTimer = setTimeout(() => { if (command.value.trim() && session.state.question?.id === questionId) void send(command); }, 220);
    else void send(command);
    return [];
  } };
  return { engine, countryIndex, subscribe(callback: (events: readonly GameEvent[]) => void) { listener = callback; return () => { listener = null; clearTimeout(autoTimer); }; },
    prompt(): PromptContent | null { const q = session.state.question; return q ? { kind: q.kind === "image" || q.kind === "flag-colors" ? "image" : "text", value: q.asset ?? q.text,
      ...(session.mode === "shapes" ? { presentation: "shape" as const } : session.mode === "flag-colors" ? { presentation: "flag-colors" as const } : {}) } : null; } };
}
