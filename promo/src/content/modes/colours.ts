// Flag colours: the flag fills in one colour at a time while you think.
import {pickCountry, type Kit, type ModeDef} from './kit';

const COLOR_RE = /(fill|stop-color|stroke)\s*(=\s*"|:\s*)(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)/g;
const norm = (c: string) => {
  c = c.toLowerCase();
  if (c === 'white') return '#ffffff';
  if (c === 'black') return '#000000';
  if (/^#[0-9a-f]{3}$/.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('');
  return c;
};

export const flagColours = (k: Kit, code: string) => {
  const svg = k.assets.flagSvg(code);
  const seen: string[] = [];
  for (const m of svg.matchAll(COLOR_RE)) {
    const c = norm(m[3]);
    if (c.startsWith('#') && !seen.includes(c)) seen.push(c);
  }
  return {svg, colours: seen};
};

/** Stage SVGs: neutral colours first (they give little away), then the rest; at most 4 steps, then the real flag. */
const colourStages = (k: Kit, code: string) => {
  const {svg, colours} = flagColours(k, code);
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  const sat = (h: string) => {
    const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(...v) - Math.min(...v);
  };
  const order = colours.slice().sort((a, b) => sat(a) - sat(b) || lum(b) - lum(a));
  const steps: string[][] = order.length <= 4 ? order.map((c) => [c]) : [...order.slice(0, 3).map((c) => [c]), order.slice(3)];
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1]?.split(/\s+/).map(Number);
  const sw = vb ? (vb[2] * 0.006).toFixed(2) : '2';
  const stages: string[] = [];
  for (let s = 0; s < steps.length; s++) {
    const shown = new Set(steps.slice(0, s).flat());
    const out = svg.replace(COLOR_RE, (all, attr, sep, col) => {
      const c = norm(col);
      if (!c.startsWith('#') || shown.has(c)) return all;
      const grey = attr === 'stroke' ? '#55685a' : '#34443a';
      // the original closing quote follows the colour, so leave the last attribute open for it
      return sep.startsWith('=') ? `${attr}="${grey}${attr === 'fill' ? `" stroke="#55685a" stroke-width="${sw}` : ''}` : `${attr}:${grey}`;
    });
    // an element can now carry its own stroke and ours: keep the first of each attribute per tag
    const clean = out.replace(/<[^>]+>/g, (tag) => {
      const seen = new Set<string>();
      return tag.replace(/\s([a-zA-Z:-]+)="[^"]*"/g, (attr, name) => (seen.has(name) ? '' : (seen.add(name), attr)));
    });
    stages.push(k.emit(`locato/colours/${code.toLowerCase()}/${s}.svg`, clean));
  }
  stages.push(`locato/flags/${code.toLowerCase()}.svg`);
  return stages;
};

export const colours: ModeDef = {
  id: 'colours', label: 'Flag colours', tags: '#geography #flags #quiz', baseSeconds: 3, answer: 'answer.thats', pick: true,
  build: (k, r) => {
    // 2–5 colour flags reveal best
    const c = pickCountry(k, r, (x) => r.allowed(x) && (() => {
      const n = flagColours(k, x.code).colours.length;
      return n >= 2 && n <= 5;
    })());
    return {round: {type: 'colours', code: c.code, country: c.name, answer: c.name, note: c.continent, stages: colourStages(k, c.code)}, vars: {answer: c.name, country: c.name}};
  },
};
