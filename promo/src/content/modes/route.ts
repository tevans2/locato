// Overland: the fewest countries you cross by land between two others.
import {fit, union, type ModeDef} from './kit';

export const route: ModeDef = {
  id: 'route', label: 'Overland', tags: '#geography #maps #puzzle', baseSeconds: 2.5, answer: 'answer.route', map: true, pick: true,
  build: (k, r) => {
    const {byCode, geo, extras} = k.game;
    // a unique shortest land route with 1–4 countries in between, harder further down the ladder
    const want = [1, 2, 2, 3, 4][Math.min(4, Math.floor((r.i * 5) / r.n))];
    // the start comes from the selection (a fixed pick = the start); excluded countries are never crossed
    const starts = r.pick ? [r.pick] : k.shuffle(k.game.countries.filter((c) => (extras.borders[c.code] ?? []).length > 0 && geo.has(c.code) && r.allowed(c) && c.tier <= 2));
    for (const s of starts) {
      const prev = new Map<string, string | null>([[s.code, null]]);
      const count = new Map<string, number>([[s.code, 1]]);
      const depth = new Map<string, number>([[s.code, 0]]);
      let frontier = [s.code];
      while (frontier.length) {
        const next: string[] = [];
        for (const a of frontier)
          for (const b of extras.borders[a] ?? []) {
            if (!geo.has(b) || !byCode.has(b) || r.excluded(b)) continue;
            if (!depth.has(b)) {
              depth.set(b, depth.get(a)! + 1);
              prev.set(b, a);
              count.set(b, count.get(a)!);
              next.push(b);
            } else if (depth.get(b) === depth.get(a)! + 1) count.set(b, count.get(b)! + count.get(a)!);
          }
        frontier = next;
      }
      const ends = k.shuffle([...depth.entries()].filter(([e, d]) => d === want + 1 && count.get(e) === 1 && byCode.get(e)!.tier <= 2).map(([e]) => e));
      const e = ends[0];
      if (!e) continue;
      const path: string[] = [];
      for (let x = prev.get(e)!; x && x !== s.code; x = prev.get(x)!) path.unshift(x);
      const all = [s.code, ...path, e];
      all.forEach((x) => k.used.add(x));
      const g = (x: string) => geo.get(x)!;
      const names = path.map((x) => byCode.get(x)!.name);
      return {
        round: {
          type: 'route',
          from: {code: s.code, name: s.name, c: g(s.code).c},
          to: {code: e, name: byCode.get(e)!.name, c: g(e).c},
          path: path.map((x) => ({code: x, name: byCode.get(x)!.name})),
          view: fit(union(k, all), 1.25, 300),
          answer: `${path.length} ${path.length === 1 ? 'country' : 'countries'}`,
          note: names.join(' → '),
          seconds: 4,
        },
        vars: {k: path.length, names: names.join(', ')},
      };
    }
    throw new Error(r.pick ? `No suitable Overland route from ${r.pick.name}` : 'No suitable Overland route for this selection');
  },
};
