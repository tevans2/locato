import type {CSSProperties} from 'react';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Slow start, faster middle, slow settle. */
export const ease = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/** 0→1 over [at, at+dur], eased. */
export const prog = (t: number, at: number, dur = 0.5) => ease((t - at) / dur);

/**
 * Visibility of something that fades in at `inAt` and out at `outAt`:
 * a little scale and blur, about half a second, never a pop.
 */
export const fade = (t: number, inAt: number, outAt = Infinity, dur = 0.5) => {
  const p = Math.min(prog(t, inAt, dur), 1 - prog(t, outAt, dur));
  return {p, style: fxStyle(p)};
};

export const fxStyle = (p: number, extra: CSSProperties = {}): CSSProperties => ({
  opacity: p,
  scale: String(0.96 + 0.04 * p),
  filter: p < 0.999 ? `blur(${(1 - p) * 8}px)` : undefined,
  ...extra,
});

export const fmtTime = (ms: number) => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
