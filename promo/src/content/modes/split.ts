// Worldsplit: a line at any angle through the world map; which side has more people?
// Each country counts on the side its centre falls. Prefers close calls (52–68%) and a different angle each round.
import {fit, type ModeDef} from './kit';

const ANGLES = [0, 15, 30, 45, 60, 75, 105, 120, 135, 150, 165]; // never straight up and down
const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
const compass = (vx: number, vy: number) => COMPASS[Math.round((((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360) / 45) % 8]; // 0 = north (screen up)

const clip = (poly: number[][], px: number, py: number, dx: number, dy: number, keep: 1 | -1) => {
  const side = (q: number[]) => keep * ((q[0] - px) * dy - (q[1] - py) * dx);
  const out: number[][] = [];
  poly.forEach((q, i) => {
    const r2 = poly[(i + 1) % poly.length];
    const s1 = side(q), s2 = side(r2);
    if (s1 >= 0) out.push(q);
    if ((s1 >= 0) !== (s2 >= 0)) {
      const t = s1 / (s1 - s2);
      out.push([q[0] + (r2[0] - q[0]) * t, q[1] + (r2[1] - q[1]) * t]);
    }
  });
  return out;
};

export const split: ModeDef = {
  id: 'split', label: 'Worldsplit', tags: '#geography #population #maps', baseSeconds: 2.5, answer: 'answer.split', map: true,
  build: (k) => {
    const {world, extras} = k.game;
    const view = fit([0, 120, world.width, world.height - 80], 1); // the whole world: every person counts
    const [vx0, vy0, vx1, vy1] = view;
    const rect = [[vx0, vy0], [vx1, vy0], [vx1, vy1], [vx0, vy1]];
    const people = world.countries.map((g) => ({c: g.c, pop: extras.population[g.code] ?? 0}));
    let best: {score: number; angle: number; px: number; py: number; dx: number; dy: number; a: number; b: number} | null = null;
    for (let tries = 0; tries < 400; tries++) {
      const angle = ANGLES[Math.floor(k.rand() * 11)];
      if (k.used.has(`split:${angle}`) && tries < 300) continue;
      const theta = (angle * Math.PI) / 180;
      const dx = Math.cos(theta), dy = Math.sin(theta);
      const px = world.width * (0.3 + k.rand() * 0.45), py = world.height * (0.3 + k.rand() * 0.35);
      let a = 0, b = 0;
      for (const q of people) ((q.c[0] - px) * dy - (q.c[1] - py) * dx >= 0 ? (a += q.pop) : (b += q.pop));
      const share = Math.max(a, b) / (a + b);
      const score = share >= 0.52 && share <= 0.68 ? 1 : share < 0.52 ? 0.5 : 0.2;
      if (!best || score > best.score) best = {score, angle, px, py, dx, dy, a, b};
      if (score === 1 && !k.used.has(`split:${angle}`)) break;
    }
    k.used.add(`split:${best!.angle}`);
    const {px, py, dx, dy} = best!;
    const polyA = clip(rect, px, py, dx, dy, 1), polyB = clip(rect, px, py, dx, dy, -1);
    const cen = (poly: number[][]) => [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
    const [ax, ay] = cen(polyA), [bx, by] = cen(polyB);
    // the line's ends: where it crosses the view
    const ts = [vx0, vx1].map((x) => (Math.abs(dx) > 1e-6 ? (x - px) / dx : Infinity)).concat([vy0, vy1].map((y) => (Math.abs(dy) > 1e-6 ? (y - py) / dy : Infinity)));
    const hits = ts.filter(Number.isFinite).map((t) => [px + dx * t, py + dy * t]).filter(([x, y]) => x >= vx0 - 1 && x <= vx1 + 1 && y >= vy0 - 1 && y <= vy1 + 1);
    hits.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1]);
    const ends = [hits[0], hits[hits.length - 1]];
    // name each side by the line's perpendicular, pointing into that side, so the names are always opposites
    let nx = dy, ny = -dx;
    if ((ax - px) * nx + (ay - py) * ny < 0) (nx = -nx), (ny = -ny);
    const labelA = compass(nx, ny), labelB = compass(-nx, -ny);
    const winA = best!.a >= best!.b;
    const pct = Math.round((Math.max(best!.a, best!.b) / (best!.a + best!.b)) * 100);
    const win = winA ? labelA : labelB;
    const r1 = (q: number[]) => q.map((v) => +v.toFixed(1)) as [number, number];
    return {
      round: {
        type: 'split', view, a: r1(ends[0]), b: r1(ends[1]),
        sideA: {label: labelA, pop: Math.round(best!.a), at: r1([ax, ay]), poly: polyA.map(r1)},
        sideB: {label: labelB, pop: Math.round(best!.b), at: r1([bx, by]), poly: polyB.map(r1)},
        answer: `${win}: ${pct}%`, note: `${pct}% vs ${100 - pct}% of the world`, seconds: 4,
      },
      vars: {side: win.toLowerCase(), pct},
    };
  },
};
