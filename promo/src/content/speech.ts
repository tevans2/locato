// Turning a written line into what a voice should say, and judging whether a recording said it.
// Pure (no Node APIs): the voice tools on the Mac use it; anything else can too.

export type Pronunciations = {words: Record<string, string>};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * What the voice is given: dictionary respellings (longest names first, whole words only), then accents dropped,
 * "5/5" → "5 out of 5", "#5" → "number 5", "vs" → "versus", times read out.
 */
export function speakable(text: string, dict: Pronunciations, opts: {respell?: boolean} = {}) {
  let s = text;
  if (opts.respell !== false) {
    const names = Object.keys(dict.words).sort((a, b) => b.length - a.length);
    for (const name of names) s = s.replace(new RegExp(`(?<![\\p{L}])${escapeRe(name)}(?![\\p{L}])`, 'gu'), dict.words[name]);
  } else s = s.replace(/locato\.quest/g, dict.words['locato.quest'] ?? 'locato dot quest');
  return stripAccents(s)
    .replace(/\bvs\.?(?=\s)/g, 'versus')
    .replace(/(\d+)\s*\/\s*(\d+)/g, '$1 out of $2')
    .replace(/#(\d+)/g, 'number $1')
    .replace(/(\d+):(\d\d)\.(\d)/g, '$1 minutes $2 point $3 seconds');
}

/** Does this line use a dictionary respelling? */
export const isRespelled = (text: string, dict: Pronunciations) => speakable(text, dict) !== speakable(text, dict, {respell: false});

// ---- judging a recording (speech recognition output vs the written line) -----------------------------------------
const NUM: Record<string, string> = {0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve'};
const words = (s: string) =>
  stripAccents(s).toLowerCase().replace(/(\p{L})-(\p{L})/gu, '$1$2').replace(/\bvs\.?(?=\s)/g, 'versus').replace(/\d+/g, (d) => NUM[d] ?? d).replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const lev = (a: string | string[], b: string | string[]) => {
  const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

// small words recognition often swaps or drops; "dot" because it writes our domain as "locato.quest"
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'with', 'was', 'is', 'it', 'its', "it's", 'at', 'of', 'in', 'on', 'and', 'to', 'for', 'dot']);
// recognition often drops the 's of a contraction ("That's Nauru" → "That now-roo"): "that's" heard as "that" counts
const sameWord = (x: string, y: string) => x === y || lev(x, y) <= Math.max(1, Math.floor(x.length / 4)) || x.replace(/'s$/, '') === y.replace(/'s$/, '');

/** Word-level edit script between two word lists (fuzzy word equality): which written words weren't heard as written. */
function wordEdits(w: string[], h: string[]) {
  const d = Array.from({length: w.length + 1}, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= w.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (sameWord(w[i - 1], h[j - 1]) ? 0 : 1));
  // walk back to list the written words that were changed or dropped
  const bad: string[] = [];
  let i = w.length, j = h.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (sameWord(w[i - 1], h[j - 1]) ? 0 : 1)) { if (!sameWord(w[i - 1], h[j - 1])) bad.push(w[i - 1]); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { bad.push(w[i - 1]); i--; }
    else { if (!FUNCTION_WORDS.has(h[j - 1])) bad.push(`+${h[j - 1]}`); j--; }
  }
  return bad;
}

/** A rough sound skeleton: consonant sounds only, spelling noise removed. Speech recognition often *spells* unusual
 *  names differently even when they're said right ("Ouagadougou" → "Oaga Dougu"); skeletons still agree ("gdg"),
 *  while a real mispronunciation ("Wagadoo Google" → "gdggl") doesn't. */
export function soundKey(s: string) {
  return words(s)
    // non-rhotic accents (British voices) drop an r before a consonant or at the end of a word: "Bar-buda" → "Babuda"
    .map((w) => w.replace(/r(?=[^aeiouy]|$)/g, ''))
    .join('')
    .replace(/ph/g, 'f').replace(/gh/g, 'g').replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/dj/g, 'j').replace(/zh/g, 'j').replace(/sh/g, 's')
    .replace(/[aeiouyhw']/g, '')
    .replace(/(.)\1+/g, '$1');
}
const nameOk = (name: string, respelled: string, heard: string) => {
  const kh = soundKey(heard);
  return [soundKey(name), soundKey(respelled)].some((k) => lev(k, kh) <= (k.length <= 3 ? 0 : Math.max(1, Math.round(k.length * 0.15))));
};

/**
 * Did the recording say the line? `names` are the parts judged by sound (country, capital, place); every other word
 * must be heard in order, with at most one slip on a small word ("with" heard as "was"). Returns why it failed.
 */
export function judgeLine(wrote: string, heard: string, dict: Pronunciations, names: string[] = []): {ok: boolean; why: string} {
  const plain = (t: string) => words(speakable(t.replace(/locato\.quest/g, 'locato quest'), dict, {respell: false}).replace(/%/g, ' percent'));
  const h = words(heard.replace(/%/g, ' percent'));
  const name = names.find((n) => wrote.includes(n));
  if (!name) {
    const w = plain(wrote);
    const bad = wordEdits(w, h);
    const serious = bad.filter((b) => !FUNCTION_WORDS.has(b.replace(/^\+/, '')));
    if (serious.length === 0 && bad.length <= 1) return {ok: true, why: ''};
    // the same letters, split or joined differently ("southwest" / "south west"): near-identical once spaces are gone
    const jw = w.join(''), jh = h.join('');
    if (lev(jw, jh) <= Math.max(1, Math.floor(jw.length * 0.04))) return {ok: true, why: ''};
    return {ok: false, why: `words: ${bad.join(', ')}`};
  }
  // fixed words before and after the name, matched from each end; what's left in the middle is the name
  const at = wrote.indexOf(name);
  const pre = plain(wrote.slice(0, at)), post = plain(wrote.slice(at + name.length));
  let i = 0, slips = 0;
  for (const w of pre) {
    if (i < h.length && sameWord(w, h[i])) i++;
    else if (FUNCTION_WORDS.has(w) && slips++ === 0) { if (i < h.length && !sameWord(w, h[i]) && FUNCTION_WORDS.has(h[i])) i++; }
    else return {ok: false, why: `"${w}" before the name`};
  }
  let j = h.length;
  for (const w of [...post].reverse()) {
    if (j > i && sameWord(w, h[j - 1])) j--;
    else if (FUNCTION_WORDS.has(w) && slips++ === 0) { if (j > i && FUNCTION_WORDS.has(h[j - 1])) j--; }
    else return {ok: false, why: `"${w}" after the name`};
  }
  const middle = h.slice(i, j).join(' ');
  return nameOk(name, speakable(name, dict), middle) ? {ok: true, why: ''} : {ok: false, why: `name heard as "${middle}"`};
}

/** Share of written words heard (fuzzy), 0–1; joined letters rescue split words ("Kyrgyz stan"). */
export function wordMatch(wrote: string, heard: string) {
  const w = words(wrote), h = words(heard);
  if (!w.length) return 1;
  const hit = w.filter((x) => h.some((y) => lev(x, y) <= Math.max(1, Math.floor(x.length / 4)))).length / w.length;
  const joined = 1 - lev(w.join(''), h.join('')) / Math.max(w.join('').length, 1);
  return hit >= 0.8 ? hit : joined >= 0.9 ? joined : Math.min(hit, joined);
}
