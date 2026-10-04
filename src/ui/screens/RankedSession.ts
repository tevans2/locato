import { rankedRequest, type RankedAction, type RankedState } from "../../core/ranked";
import type { GameModeId } from "../../core/gameModes";
import { leaderboardConfig } from "../../core/leaderboards";
import type { TimedRunPosting } from "../../core/timer/leaderboardSync";

/** Transport behind the existing screens. Only a completed server receipt can post a result. */
export class RankedSession {
  private readonly controller = new AbortController();
  private snapshot: RankedState | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private offset = 0;
  private firstGuessAt: number | null = null;
  constructor(readonly mode: GameModeId, readonly variant = "") {}
  get state(): RankedState { if (!this.snapshot) throw new Error("The game has not started."); return this.snapshot; }
  get signal(): AbortSignal { return this.controller.signal; }
  elapsedMs(): number {
    if (this.state.timeMs !== null) return this.state.timeMs;
    if (this.firstGuessAt !== null) return Math.max(0, performance.now() - this.firstGuessAt);
    return this.state.startedAt === null ? 0 : Math.max(0, this.now() - this.state.startedAt);
  }
  noteGuess(): void { this.firstGuessAt ??= performance.now(); }
  now(): number { return performance.now() + this.offset; }
  private accept(value: RankedState): RankedState { this.snapshot = value; this.offset = value.serverNow - performance.now(); return value; }
  async start(): Promise<RankedState> {
    await this.chain.catch(() => {});
    const value = this.accept(await rankedRequest<RankedState>("/api/ranked/start", { gameMode: this.mode, variant: this.variant }, this.signal));
    this.firstGuessAt = null;
    return value;
  }
  move(action: Omit<RankedAction, "runId" | "questionId">): Promise<RankedState> {
    const runId = this.state.runId;
    const questionId = this.state.question?.id;
    const task = this.chain.catch(() => {}).then(async () => {
      if (this.signal.aborted) throw new Error("Game closed.");
      if (this.state.runId !== runId || (this.mode !== "name-all" && action.auto && this.state.question?.id !== questionId)) return this.state;
      if (this.mode !== "flyover" && this.mode !== "name-all" && this.state.question?.id !== questionId) throw new Error("That challenge is no longer active.");
      const activeQuestionId = this.mode === "name-all" ? this.state.question?.id : questionId;
      const value = this.accept(await rankedRequest<RankedState>("/api/ranked/action", { ...action, runId, questionId: activeQuestionId }, this.signal));
      return value;
    });
    this.chain = task;
    return task;
  }
  readonly post = async (): Promise<TimedRunPosting> => {
    const state = this.state;
    if (state.status !== "complete") return { serverAccepted: false, rank: null, failed: true };
    const metric = leaderboardConfig(this.mode)!.metric;
    try {
      const result = await rankedRequest<{ accepted: boolean; rank?: number }>("/api/leaderboard", {
        gameMode: this.mode, variant: this.variant, runId: state.runId,
        ...(metric === "time" ? { timeMs: state.timeMs } : { score: state.score }),
      }, this.signal);
      return { serverAccepted: result.accepted, rank: result.rank ?? null };
    } catch { return { serverAccepted: false, rank: null, failed: true }; }
  };
  destroy(): void { this.controller.abort(); }
}
