// The voice library: recorded lines reused by every video that says them. Clips are made on the Mac (Chatterbox /
// Kokoro) or recorded by a person, and uploaded through the promo service, which keeps the audio in R2 (public:
// media.locato.quest/audio/voice/…) and the records in D1, so the admin can pick a clip the moment it's uploaded.
// Nothing is generated on a server. Pure (no Node APIs).
//
// A clip's key comes from the line's text, so "That's Kenya!" is one clip per voice, whichever video says it.
// Audio files are versioned (…/<key>-<v>.<ext>), so a new take gets a new URL and caches never serve an old one.
import {z} from 'zod';

export const VoiceInfo = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().optional(),
  /** human = recorded by a person */
  engine: z.enum(['chatterbox', 'kokoro', 'human', 'other']),
  /** Engine settings, so more lines can be generated to match (e.g. {intensity: "lively"}). */
  settings: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  disabled: z.boolean().optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfo>;

export const ClipInfo = z.object({
  key: z.string(),
  /** The line as written (what videos ask for). */
  text: z.string(),
  /** R2 key of the audio (public bucket). */
  file: z.string(),
  /** Public URL of the audio. */
  url: z.string().optional(),
  duration: z.number().positive(),
  bytes: z.number().int().nonnegative(),
  addedAt: z.string(),
  source: z.enum(['generated', 'recorded', 'uploaded']),
  /** Speech-recognition check, if one was run: what it heard and how well it matched (0–1). */
  check: z.object({heard: z.string(), score: z.number()}).optional(),
});
export type ClipInfo = z.infer<typeof ClipInfo>;

/** Where a clip's audio lives in the public bucket. */
export const clipFile = (voice: string, key: string, version: string, ext: string) => `audio/voice/${voice}/${key}-${version}.${ext}`;

/** Same line, same key: trims, collapses spaces, and ignores case and curly quotes. */
export const normLine = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase();
/** A short stable hash (cyrb53), so keys work the same in Node, Bun and the browser. */
export const hash = (s: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
};
export const clipKey = (text: string) => hash(normLine(text));

// ---- what a video needs said ------------------------------------------------------------------------------------
export type VoiceLine = {slot: 'hook' | 'answers' | 'outro' | 'cta' | 'result'; index?: number; text: string};

const spokenHook = (title: string) => {
  const t = title.trim();
  if (/[?.!]$/.test(t)) return t;
  if (/^name these/i.test(t)) return `Can you n${t.slice(1)}?`;
  return `${t}.`;
};
const stripNote = (s: string) => s.replace(/[^\p{L}\p{N}\s'’!?.,]/gu, '').trim();

/**
 * Every line a spec's voice says, in order. Recipe-made specs carry their lines (voiceText, round.say);
 * older specs fall back to the same defaults as tools/voice/voice.mjs. Keep the two in step.
 */
export function voiceLines(template: string, p: any): VoiceLine[] {
  const o = p.voiceText ?? {};
  const spokenNote: Record<string, string> = {quiz: p.mode === 'one-life' ? 'Comment your round!' : 'Comment your score!', daily: 'Comment your score!', lookalikes: 'Comment your score!', speedrun: 'Comment your best time!', clip: 'Comment your best time!', versus: "Tag who you'd race!", leaderboard: p.metric === 'time' ? 'Comment your best time!' : 'Comment your best score!'};
  const note = p.outro?.note ? stripNote(p.outro.note) : spokenNote[template];
  const lines: VoiceLine[] = [];
  const add = (slot: VoiceLine['slot'], text: string | undefined, index?: number) => text && lines.push({slot, text, ...(index !== undefined ? {index} : {})});
  let hook: string | undefined = o.hook ?? (p.title?.trim() ? spokenHook(p.title) : undefined);
  if (template === 'daily') hook = o.hook ?? `Warm up for today's Daily: ${p.badge}!`;
  if (template === 'leaderboard' && !o.hook) {
    const m = /^Top (\d+): (.+)$/.exec(String(p.title).trim());
    if (m) hook = `The top ${m[1]} on the ${m[2]} leaderboard.`;
  }
  add('hook', hook);
  if (template === 'quiz' || template === 'daily') p.rounds.forEach((r: any, i: number) => add('answers', r.say ?? `That's ${r.answer}!`, i));
  if (template === 'lookalikes') p.sets.forEach((s: any, i: number) => add('answers', s.items.map((x: any) => x.name).join('. ') + '.', i));
  if (template === 'versus') add('result', o.result ?? (p.winner ? `${p[p.winner].name} wins!` : undefined));
  if (template === 'leaderboard') add('result', o.result ?? (p.entries?.[0] ? `${p.entries[0].name} takes first place!` : undefined));
  add('outro', o.outro ?? (p.outro?.question ? `${p.outro.question} ${note}` : undefined));
  const n = p.rounds?.length;
  const cta =
    o.cta ??
    (template === 'quiz' ? (p.mode === 'one-life' ? 'Made it to the end? Prove it at locato.quest!' : `Got ${n} out of ${n}? Prove it at locato.quest!`)
    : template === 'daily' ? "Play today's Daily for free at locato.quest!"
    : template === 'speedrun' || template === 'clip' ? 'Think you can beat it? Play it free at locato.quest!'
    : 'Play it free at locato.quest!');
  add('cta', cta);
  return lines;
}

/** Which of these lines a voice already has. */
export function coverage(voice: {clips: Record<string, ClipInfo>}, lines: VoiceLine[]) {
  const have: (VoiceLine & {clip: ClipInfo})[] = [];
  const missing: VoiceLine[] = [];
  for (const l of lines) {
    const clip = voice.clips[clipKey(l.text)];
    if (clip) have.push({...l, clip});
    else missing.push(l);
  }
  return {have, missing, complete: missing.length === 0};
}
