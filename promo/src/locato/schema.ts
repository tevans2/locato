// Props for every Locato template. A video = {template, props} in a JSON file under videos/.
// Durations are derived from the props, so adding rounds or a longer clip just works.

export type Outro = {
  /** Small line under the question, e.g. "Comment your score 👇". Defaults per template. */
  note?: string;
  /** Asked before the end card, e.g. "How many did you get?" */
  question?: string;
  /** Line on the end card under the URL. */
  cta?: string;
};

export type Media = {
  /** Path inside public/, e.g. "locato/clips/run.mp4" */
  src: string;
  width: number;
  height: number;
  /** Seconds of the source file. */
  duration: number;
  /** Seconds to skip at the start / stop before the end of the source. */
  trimStart?: number;
  trimEnd?: number;
  playbackRate?: number;
  muted?: boolean;
};

export type Music = {src: string; volume?: number};

/** A spoken line, made by tools/voice/voice.mjs (local Kokoro TTS). */
export type VoiceClip = {src: string; duration: number; text: string};
export type Voice = {
  hook?: VoiceClip; // over the opening title
  answers?: VoiceClip[]; // one per round / set, on the reveal
  result?: VoiceClip; // versus winner / leaderboard first place
  outro?: VoiceClip; // with the closing question
  cta?: VoiceClip; // with the end card
};
const vd = (c?: VoiceClip) => (c ? c.duration : 0);

/** Lengths of the closing question and end card, stretched to fit their voice lines. */
export const outroLens = (p: {outro?: Outro; voice?: Voice}) => ({
  q: p.outro?.question ? Math.max(2.2, vd(p.voice?.outro) + 0.6) : 0,
  end: Math.max(2.4, vd(p.voice?.cta) + 0.8),
});

/** Sound for any template. Defaults: game sound effects on, the Locato music bed underneath. */
export type Sound = {
  /** Locato's game sounds (whoosh, countdown ticks, correct chime, fanfare). Default true. */
  effects?: boolean;
  /** Background music: omit for the default bed, false for none, or your own track. */
  music?: Music | false;
};

// ---- quiz: the Score Challenge engine ---------------------------------------------
// Every Locato mode is a round type, so the same proven structure applies to all of them:
// challenge on screen at frame 0, an easy → boss ladder, a visible n/N counter, short timers on
// easy rounds, reveals that flow straight into the next question, then "Got 5/5? Prove it".

export type Box = [number, number, number, number]; // map view, in public/locato/map/world.json coordinates

type RoundBase = {
  answer: string; // revealed on screen
  note?: string; // small line under the answer
  say?: string; // what the voice says on the reveal (default "That's <answer>!")
  prompt?: string; // the round's question line (map and text rounds)
  seconds?: number; // thinking time for this round
  boss?: boolean; // the final, hardest round
};
export type QuizRound = RoundBase &
  (
    | {type: 'flag' | 'shape' | 'capital' | 'capital-of' | 'code'; code: string; country: string}
    /** Flag colours: the flag fills in colour by colour while you think (stages[0] = no colour). */
    | {type: 'colours'; code: string; country: string; stages: string[]}
    /** "Which one is it?": a flag or outline with 2–3 look-alike names to choose from. */
    | {type: 'which'; code: string; country: string; options: string[]; skill: 'flag' | 'shape'}
    /** Spot the country (lit up) / Find the country (named, then revealed). */
    | {type: 'spot' | 'find'; code: string; country: string; view: Box; c: [number, number]}
    /** MapTap: where is this place? */
    | {type: 'pin'; place: string; code?: string; view: Box; x: number; y: number}
    /** Overland: fewest countries between two others. */
    | {type: 'route'; from: {code: string; name: string; c: [number, number]}; to: {code: string; name: string; c: [number, number]}; path: {code: string; name: string}[]; view: Box}
    /** Worldsplit: which side of the line has more people? */
    | {
        type: 'split';
        view: Box;
        a: [number, number]; // the line's ends, where it crosses the view
        b: [number, number];
        sideA: {label: string; pop: number; at: [number, number]; poly: [number, number][]};
        sideB: {label: string; pop: number; at: [number, number]; poly: [number, number][]};
      }
  );

export type QuizProps = {
  /** 'daily' picks the Daily's default music. */
  variant?: 'daily';
  /** 'one-life': one wrong and you're out (changes the counter, hook and outro). */
  mode?: 'score' | 'one-life';
  title: string;
  badge?: string;
  rounds: QuizRound[];
  secondsPerRound?: number;
  outro?: Outro;
  music?: Music | false;
  effects?: boolean;
  voice?: Voice;
  /** Override what the voice says (written by tools/voice/voice.mjs into `voice`). */
  voiceText?: Partial<Record<'hook' | 'outro' | 'cta' | 'result', string>>;
  /** Creative variables for testing (format, hook, timers…); not shown. */
  meta?: Record<string, unknown>;
};

export const QUIZ = {enter: 0.3, overlap: 0.25, minHold: 0.85, firstThink: 0.7, outroQ: 2.2, endCard: 2.4};
const roundExtra = (r: QuizRound) =>
  r.type === 'route' ? 0.35 * r.path.length + 0.5 : r.type === 'split' ? 0.6 : r.type === 'pin' || r.type === 'find' ? 0.3 : 0;

/** Per-round timing. Round 1 is on screen from frame 0; each reveal flows into the next round. */
export const quizTiming = (p: QuizProps) => {
  const starts: number[] = [], thinks: number[] = [], reveals: number[] = [], holds: number[] = [];
  let t = 0;
  p.rounds.forEach((r, i) => {
    const secs = r.seconds ?? p.secondsPerRound ?? 3;
    const start = i === 0 ? 0 : t;
    const think = i === 0 ? Math.max(QUIZ.firstThink, vd(p.voice?.hook) + 0.05) : start + QUIZ.enter;
    const reveal = think + secs;
    const hold = Math.max(QUIZ.minHold + roundExtra(r), vd(p.voice?.answers?.[i]) + 0.25);
    starts.push(start); thinks.push(think); reveals.push(reveal); holds.push(hold);
    t = reveal + hold - QUIZ.overlap;
  });
  const n = p.rounds.length;
  const roundsEnd = n ? reveals[n - 1] + holds[n - 1] : 0;
  return {starts, thinks, reveals, holds, roundsEnd, ...outroLens(p)};
};
export const quizDuration = (p: QuizProps) => {
  const q = quizTiming(p);
  return q.roundsEnd + 0.2 + q.q + q.end;
};

// ---- look-alikes ------------------------------------------------------------

export type LookalikeSet = {
  skill: 'flag' | 'shape';
  items: {code: string; name: string}[];
  tip: string;
};

export type LookalikesProps = {
  title: string;
  badge?: string;
  sets: LookalikeSet[];
  secondsPerSet?: number; // thinking time
  outro?: Outro;
  music?: Music | false;
  effects?: boolean;
  voice?: Voice;
  /** Override what the voice says (written by tools/voice/voice.mjs into `voice`). */
  voiceText?: Partial<Record<'hook' | 'outro' | 'cta' | 'result', string>>;
};

export const LOOK = {intro: 0.75, enter: 0.5, reveal: 3.8};
export const lookTiming = (p: LookalikesProps) => {
  const secs = p.secondsPerSet ?? 4;
  const intro = Math.max(LOOK.intro, vd(p.voice?.hook) - 0.5);
  const reveal = Math.max(LOOK.reveal, Math.max(0, ...(p.voice?.answers ?? []).map(vd)) + 1.6);
  const setLen = LOOK.enter + secs + reveal;
  const setsEnd = intro + p.sets.length * setLen;
  return {secs, intro, reveal, setLen, setsEnd, ...outroLens(p)};
};
export const lookSetLen = (p: LookalikesProps) => lookTiming(p).setLen;
export const lookDuration = (p: LookalikesProps) => {
  const l = lookTiming(p);
  return l.setsEnd + 0.2 + l.q + l.end;
};

// ---- screen-recording clip (speedruns, records, features) --------------------

export type ClipProps = {
  title: string;
  badge?: string;
  clip: Media;
  /** A running clock between two moments of the clip (clip seconds, after trimStart). */
  timer?: {start: number; stop: number; label?: string};
  /** Short captions that appear over time (clip seconds). */
  callouts?: {at: number; text: string; duration?: number}[];
  /** Slow push-ins on part of the recording. x/y are 0–1 inside the clip. */
  zooms?: {start: number; end: number; x: number; y: number; scale: number}[];
  outro?: Outro;
  music?: Music | false;
  effects?: boolean;
  voice?: Voice;
  /** Override what the voice says (written by tools/voice/voice.mjs into `voice`). */
  voiceText?: Partial<Record<'hook' | 'outro' | 'cta' | 'result', string>>;
};

export const clipLen = (m: Media) => (m.duration - (m.trimStart ?? 0) - (m.trimEnd ?? 0)) / (m.playbackRate ?? 1);
export const clipDuration = (p: ClipProps) => {
  const o = outroLens(p);
  return clipLen(p.clip) + 0.6 + o.q + o.end;
};

// ---- versus (two recordings racing) -----------------------------------------

export type Player = {name: string; emoji?: string; clip: Media; result?: string};

export type VersusProps = {
  title: string;
  badge?: string;
  top: Player;
  bottom: Player;
  winner?: 'top' | 'bottom';
  outro?: Outro;
  music?: Music | false;
  effects?: boolean;
  voice?: Voice;
  /** Override what the voice says (written by tools/voice/voice.mjs into `voice`). */
  voiceText?: Partial<Record<'hook' | 'outro' | 'cta' | 'result', string>>;
};

export const VERSUS_RESULT = 2.2;
/** Winner moment, long enough for the spoken result. */
export const versusResultLen = (p: VersusProps) => Math.max(VERSUS_RESULT, vd(p.voice?.result) + 0.7);
export const versusDuration = (p: VersusProps) =>
  Math.max(clipLen(p.top.clip), clipLen(p.bottom.clip)) + versusResultLen(p) + 0.2 + outroLens(p).q + outroLens(p).end;

// ---- leaderboard ------------------------------------------------------------

export type LeaderboardProps = {
  title: string;
  badge?: string;
  metric: 'time' | 'score';
  maxScore?: number;
  entries: {rank: number; name: string; emoji?: string | null; value: number}[];
  outro?: Outro;
  music?: Music | false;
  effects?: boolean;
  voice?: Voice;
  /** Override what the voice says (written by tools/voice/voice.mjs into `voice`). */
  voiceText?: Partial<Record<'hook' | 'outro' | 'cta' | 'result', string>>;
};

export const BOARD = {intro: 0.5, podium: 2.4, rowStagger: 0.28, hold: 2.2};
/** Podium starts once the spoken title is mostly done; the hold stretches for the spoken result. */
export const boardTiming = (p: LeaderboardProps) => {
  const intro = Math.max(BOARD.intro, vd(p.voice?.hook) - 0.4);
  const rowsAt = intro + BOARD.podium;
  const rows = Math.max(0, p.entries.length - 3);
  const hold = Math.max(BOARD.hold, vd(p.voice?.result) - rows * BOARD.rowStagger + 0.6);
  return {intro, podiumAt: intro, rowsAt, end: rowsAt + rows * BOARD.rowStagger + hold};
};
export const boardDuration = (p: LeaderboardProps) =>
  boardTiming(p).end + 0.2 + outroLens(p).q + outroLens(p).end;
