// Map modes: Spot the country (lit up), Find the country (named, then revealed), MapTap (where is this place?).
import {fit, pickCountry, type ModeDef} from './kit';

export const spot: ModeDef = {
  id: 'spot', label: 'Spot the country', tags: '#geography #maps #quiz', baseSeconds: 2.5, answer: 'answer.thats', map: true, pick: true,
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    const g = k.game.geo.get(c.code)!;
    return {round: {type: 'spot', code: c.code, country: c.name, answer: c.name, note: c.continent, view: fit(g.main, 3.2, 260), c: g.c}, vars: {answer: c.name, country: c.name}};
  },
};

export const find: ModeDef = {
  id: 'find', label: 'Click the country', tags: '#geography #maps #quiz', baseSeconds: 2.5, answer: 'answer.thats', map: true, pick: true,
  build: (k, r) => {
    const c = pickCountry(k, r, r.allowed);
    const g = k.game.geo.get(c.code)!;
    // a wide view so finding it is the challenge; jitter so the answer isn't always in the middle
    const v = fit(g.main, 6, 640);
    const jx = (k.rand() - 0.5) * (v[2] - v[0]) * 0.3, jy = (k.rand() - 0.5) * (v[3] - v[1]) * 0.3;
    const view = v.map((x, i) => +(x + (i % 2 ? jy : jx)).toFixed(1)) as typeof v;
    return {round: {type: 'find', code: c.code, country: c.name, answer: c.name, note: c.continent, view, c: g.c}, vars: {answer: c.name, country: c.name}};
  },
};

const PLACE_KIND: Record<string, string> = {city: 'City', landmark: 'Landmark', mountain: 'Mountain'};

export const pin: ModeDef = {
  id: 'pin', label: 'MapTap', tags: '#geography #maps #quiz', baseSeconds: 2.5, answer: 'answer.pin', map: true,
  build: (k, r) => {
    const {byCode} = k.game;
    const diff = (['easy', 'easy', 'medium', 'hard', 'hard'] as const)[Math.min(4, Math.floor((r.i * 5) / r.n))];
    const want = r.recipe.level ?? diff;
    // single-point places only: a range or region doesn't belong to one country
    const pool = k.shuffle(k.game.extras.places.filter((p) => ['city', 'landmark', 'mountain'].includes(p.category) && p.country && byCode.has(p.country) && !k.used.has('pin:' + p.id) && r.allowed(byCode.get(p.country)!)));
    const p = pool.find((x) => x.difficulty === want) ?? pool[0];
    if (!p) throw new Error('Out of MapTap places for this selection');
    k.used.add('pin:' + p.id);
    const country = byCode.get(p.country!)!;
    const view = fit([p.x - 1, p.y - 1, p.x + 1, p.y + 1], 1, 900);
    return {
      round: {type: 'pin', place: p.name, code: country.code, answer: `In ${country.name}`, note: PLACE_KIND[p.category] ?? p.category, view, x: p.x, y: p.y},
      vars: {country: country.name, place: p.name},
    };
  },
};
