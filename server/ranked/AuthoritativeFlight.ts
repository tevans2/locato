import { FLYOVER_SKIP_PENALTY_SECONDS, FLYOVER_SKIP_HOLD_SECONDS, pickNextTarget, planeTouchesCountry, startingPlane, stepPlane, type FlyoverCountry, type PlaneInput, type PlaneState, type Rng } from "../../src/core/flyover";

/** Advance only server time with server constants. A client supplies controls, never a position. */
export class AuthoritativeFlight {
  plane: PlaneState;
  target: FlyoverCountry | null;
  score = 0;
  lastReachAt: number | null = null;
  index = 0;
  holdUntil = 0;
  readonly visited = new Set<string>();
  readonly reaches: { readonly code: string; readonly seconds: number }[] = [];
  private targetNamedAt: number;
  private excluded = new Set<string>();
  private input: PlaneInput = { turn: 0, boost: false };
  private advancedAt: number;
  private lastInputAt: number;

  constructor(readonly countries: readonly FlyoverCountry[], readonly rng: Rng, readonly startedAt: number, public endsAt: number, start?: PlaneState, private readonly route?: readonly FlyoverCountry[]) {
    this.plane = start ?? startingPlane(countries, rng);
    this.advancedAt = startedAt;
    this.lastInputAt = startedAt;
    this.targetNamedAt = startedAt;
    this.target = this.nextTarget();
  }

  advance(now: number): void {
    const until = Math.min(now, this.endsAt);
    // Only simulate controls while their connection is alive; silence never accrues flight credit.
    while (this.advancedAt < until) {
      const dt = Math.min(1000 / 60, until - this.advancedAt);
      this.advancedAt += dt;
      if (this.advancedAt - this.lastInputAt > 1000) continue;
      this.plane = stepPlane(this.plane, this.input, dt / 1000);
      if (this.target && this.advancedAt >= this.holdUntil && planeTouchesCountry(this.target, this.plane.x, this.plane.y)) {
        this.visited.add(this.target.code);
        this.reaches.push({ code: this.target.code, seconds: (this.advancedAt - this.targetNamedAt) / 1000 });
        this.excluded.add(this.target.code);
        this.score += 1;
        this.lastReachAt = this.advancedAt;
        this.index += 1;
        this.target = this.nextTarget();
        this.targetNamedAt = this.advancedAt;
      }
    }
  }

  steer(input: PlaneInput, now: number): void {
    this.advance(now);
    this.input = { turn: input.turn, towards: input.towards ?? null, boost: input.boost === true };
    this.lastInputAt = Math.max(now, this.startedAt);
  }

  skip(now: number, multiplayer = false): void {
    this.advance(now);
    if (!this.target || now < this.startedAt || now >= this.endsAt || now < this.holdUntil) return;
    this.excluded.add(this.target.code);
    this.index += 1;
    if (multiplayer) this.holdUntil = now + FLYOVER_SKIP_HOLD_SECONDS * 1000;
    else this.endsAt -= FLYOVER_SKIP_PENALTY_SECONDS * 1000;
    this.target = this.nextTarget();
    this.targetNamedAt = now;
  }

  private nextTarget(): FlyoverCountry | null {
    return this.route ? this.route[this.index] ?? null : pickNextTarget(this.countries, [this.plane.x, this.plane.y], this.excluded, this.rng);
  }
}

export function parsePlaneInput(value: unknown): PlaneInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((key) => !["turn", "towards", "boost"].includes(key))) return null;
  if (typeof v.turn !== "number" || ![-1, 0, 1].includes(v.turn)) return null;
  if (v.towards !== undefined && v.towards !== null && (typeof v.towards !== "number" || !Number.isFinite(v.towards) || Math.abs(v.towards) > Math.PI)) return null;
  if (v.boost !== undefined && typeof v.boost !== "boolean") return null;
  return { turn: v.turn, towards: v.towards as number | null | undefined ?? null, boost: v.boost === true };
}
