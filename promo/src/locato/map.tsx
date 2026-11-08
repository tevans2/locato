import React from 'react';
import world from '../../public/locato/map/world.json';
import {C, SANS} from './brand';
import {clamp01, ease, lerp} from './anim';

// Locato's own world map (public/locato/map/world.json, made by tools/locato/sync.ts), drawn as SVG.
// Everything is in the map's projected coordinates; a round only says which box to look at.

type Country = {code: string; name: string; d: string; bbox: number[]; main: number[]; c: number[]};
const COUNTRIES = (world as {countries: Country[]}).countries;
export const MAP_COLORS = {
  ocean: '#0d140f',
  land: '#2b3a2f',
  border: '#46594b',
  hi: C.accent,
  route: '#e0a46b',
  dim: '#1f2a22',
};

export type Box = [number, number, number, number];
export type Pin = {x: number; y: number; label?: string; p: number; color?: string};
export type MapLabel = {x: number; y: number; text: string; p: number; color?: string; size?: number};

export const WorldMap: React.FC<{
  w: number;
  h: number;
  view: Box;
  /** Optional slow push-in: the view at the end of the round, and how far along we are (0–1). */
  viewEnd?: Box;
  push?: number;
  fills?: Record<string, {color: string; p: number}>;
  pins?: Pin[];
  labels?: MapLabel[];
  /** A split line from a to b, drawn in as p goes 0→1, then each side shaded (shade 0→1). */
  split?: {a: [number, number]; b: [number, number]; p: number; shade?: number; polyA?: [number, number][]; polyB?: [number, number][]};
}> = ({w, h, view, viewEnd, push = 0, fills = {}, pins = [], labels = [], split}) => {
  const k = ease(push);
  const v = viewEnd ? (view.map((a, i) => lerp(a, viewEnd[i], k)) as Box) : view;
  const [x0, y0, x1, y1] = v;
  const vw = x1 - x0, vh = y1 - y0;
  const unit = vw / w; // map units per screen px, for strokes and text that stay a fixed screen size
  const visible = COUNTRIES.filter((c) => c.bbox[2] >= x0 && c.bbox[0] <= x1 && c.bbox[3] >= y0 && c.bbox[1] <= y1);
  return (
    <svg width={w} height={h} viewBox={`${x0} ${y0} ${vw} ${vh}`} style={{display: 'block', background: MAP_COLORS.ocean}}>
      {visible.map((c) => {
        const f = fills[c.code];
        const fill = f ? mix(MAP_COLORS.land, f.color, clamp01(f.p)) : MAP_COLORS.land;
        return <path key={c.code} d={c.d} fill={fill} stroke={MAP_COLORS.border} strokeWidth={1.2 * unit} strokeLinejoin="round" />;
      })}
      {/* tiny countries (Singapore, Malta…) get a glowing ring so the highlight can be seen */}
      {visible.map((c) => {
        const f = fills[c.code];
        if (!f || f.p <= 0.01) return null;
        const size = Math.max(c.main[2] - c.main[0], c.main[3] - c.main[1]) / unit;
        if (size > 46) return null;
        const r = 34 * unit;
        return (
          <g key={`ring-${c.code}`} opacity={clamp01(f.p)}>
            <circle cx={c.c[0]} cy={c.c[1]} r={r} fill={f.color} opacity={0.22} />
            <circle cx={c.c[0]} cy={c.c[1]} r={r} fill="none" stroke={f.color} strokeWidth={4 * unit} />
          </g>
        );
      })}
      {split ? (
        <>
          {split.shade && split.polyA && split.polyB ? (
            <>
              <polygon points={split.polyA.map((q) => q.join(',')).join(' ')} fill="#78abdf" opacity={0.2 * split.shade} />
              <polygon points={split.polyB.map((q) => q.join(',')).join(' ')} fill="#ef8069" opacity={0.2 * split.shade} />
            </>
          ) : null}
          <line
            x1={split.a[0]}
            y1={split.a[1]}
            x2={lerp(split.a[0], split.b[0], ease(split.p))}
            y2={lerp(split.a[1], split.b[1], ease(split.p))}
            stroke={C.text}
            strokeWidth={4 * unit}
            strokeLinecap="round"
            strokeDasharray={`${14 * unit} ${10 * unit}`}
          />
        </>
      ) : null}
      {pins.map((pin, i) => {
        const p = ease(pin.p);
        if (p <= 0.001) return null;
        const r = 16 * unit;
        const drop = (1 - p) * 60 * unit;
        return (
          <g key={i} opacity={Math.min(1, p * 1.5)}>
            <circle cx={pin.x} cy={pin.y} r={r * 2.2 * p} fill={pin.color ?? C.accent} opacity={0.25} />
            <path
              d={`M ${pin.x} ${pin.y - drop} m 0 0 c -${r} -${r * 1.4} -${r * 1.6} -${r * 2.2} -${r * 1.6} -${r * 3} a ${r * 1.6} ${r * 1.6} 0 1 1 ${r * 3.2} 0 c 0 ${r * 0.8} -${r * 0.6} ${r * 1.6} -${r * 1.6} ${r * 3} z`}
              fill={pin.color ?? C.accent}
              stroke="#1b3023"
              strokeWidth={2.5 * unit}
            />
            <circle cx={pin.x} cy={pin.y - drop - r * 3} r={r * 0.6} fill="#1b3023" />
          </g>
        );
      })}
      {labels.map((l, i) => {
        const p = ease(l.p);
        if (p <= 0.001) return null;
        const size = (l.size ?? 34) * unit;
        return (
          <g key={i} opacity={p}>
            <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontFamily={SANS} fontWeight={800} fontSize={size} fill={l.color ?? C.text} stroke={MAP_COLORS.ocean} strokeWidth={size * 0.22} paintOrder="stroke" strokeLinejoin="round">
              {l.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/** Blend two #rrggbb colours. */
export const mix = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
};
