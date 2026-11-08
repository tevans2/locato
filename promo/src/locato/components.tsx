import React from 'react';
import {AbsoluteFill, Img, Sequence, staticFile, useVideoConfig} from 'remotion';
import {Audio} from '@remotion/media';
import {C, H, MUSIC_VOLUME, SAFE, SANS, SERIF, URL_TEXT, W} from './brand';
import {clamp01, ease, fade, fxStyle, lerp, prog} from './anim';
import type {Music, Outro, VoiceClip} from './schema';

// ---- frame ------------------------------------------------------------------

/** Dark Locato background with the game's faint grid, drifting slowly so the frame never sits dead. */
export const Frame: React.FC<{t: number; music?: Music | false; defaultMusic?: string; duck?: Span[]; guides?: boolean; children: React.ReactNode}> = ({t, music, defaultMusic, duck, guides, children}) => {
  const drift = t * 6;
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: SANS, color: C.text, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(${C.grid} 1.5px, transparent 1.5px) 0 ${drift}px / 60px 60px, linear-gradient(90deg, ${C.grid} 1.5px, transparent 1.5px) ${drift * 0.5}px 0 / 60px 60px`,
        }}
      />
      {/* soft vignette so the middle reads as the stage */}
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(5,10,7,0.55) 100%)'}} />
      {children}
      {music === false ? null : <MusicBed music={music ?? (defaultMusic ? {src: defaultMusic, volume: MUSIC_VOLUME} : DEFAULT_MUSIC)} duck={duck} />}
      {guides ? <Guides /> : null}
    </AbsoluteFill>
  );
};

export const DEFAULT_MUSIC: Music = {src: 'locato/music/bed.wav', volume: 0.7};

export type Span = [number, number];

/** Background track, looped, fading in over 0.6s and out over the last 1.2s, dipping under the voice. */
const MusicBed: React.FC<{music: Music; duck?: Span[]}> = ({music, duck = []}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const v = music.volume ?? 0.7;
  const dip = (sec: number) => {
    let k = 0;
    for (const [a, b] of duck) k = Math.max(k, Math.min(clamp01((sec - a + 0.15) / 0.15), clamp01((b + 0.25 - sec) / 0.25)));
    return 1 - 0.55 * k;
  };
  return (
    <Audio
      src={mediaSrc(music.src)}
      loop
      volume={(f) => v * dip(f / fps) * Math.min(1, f / (0.6 * fps), (durationInFrames - f) / (1.2 * fps))}
    />
  );
};

// ---- voiceover ------------------------------------------------------------------

export type VoiceCue = {at: number; clip?: VoiceClip};

/** Spoken lines at the given times. */
/** A public/ path, or a full URL (e.g. a clip in the R2 voice library). */
export const mediaSrc = (src: string) => (/^https?:\/\//.test(src) ? src : staticFile(src));

export const VoiceTrack: React.FC<{cues: VoiceCue[]}> = ({cues}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {cues
        .filter((c): c is {at: number; clip: VoiceClip} => !!c.clip && c.at >= 0)
        .map((c, i) => (
          <Sequence key={i} from={Math.round(c.at * fps)} durationInFrames={Math.ceil((c.clip.duration + 0.3) * fps)} layout="none">
            <Audio src={mediaSrc(c.clip.src)} volume={0.75} />
          </Sequence>
        ))}
    </>
  );
};

/** When the voice is speaking, so the music can dip. */
export const voiceSpans = (cues: VoiceCue[]): Span[] => cues.filter((c) => c.clip).map((c) => [c.at, c.at + c.clip!.duration]);

export type Cue = {at: number; sound: 'whoosh' | 'tick' | 'correct' | 'ping' | 'victory' | 'wrong' | 'time-up'; volume?: number};
const CUE_VOLUME: Record<Cue['sound'], number> = {whoosh: 0.7, tick: 0.8, correct: 0.65, ping: 0.75, victory: 0.8, wrong: 0.7, 'time-up': 0.7};

/** Plays Locato's game sounds at the given times (seconds). */
export const Sfx: React.FC<{cues: Cue[]; on?: boolean}> = ({cues, on = true}) => {
  const {fps} = useVideoConfig();
  if (!on) return null;
  return (
    <>
      {cues
        .filter((c) => c.at >= 0)
        .map((c, i) => (
          <Sequence key={i} from={Math.round(c.at * fps)} durationInFrames={Math.ceil(1.2 * fps)} layout="none">
            <Audio src={staticFile(`locato/sfx/${c.sound}.wav`)} volume={c.volume ?? CUE_VOLUME[c.sound]} />
          </Sequence>
        ))}
    </>
  );
};

/** Cues for the shared outro: a ping for the question, the fanfare for the end card. */
export const outroCues = (at: number, outro?: Outro, qLen = OUTRO_Q): Cue[] =>
  outro?.question ? [{at, sound: 'ping'}, {at: at + qLen, sound: 'victory'}] : [{at, sound: 'victory'}];

const Guides = () => (
  <>
    <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: SAFE.top, background: 'rgba(255,0,0,0.15)', borderBottom: '2px dashed red'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.bottom, bottom: 0, background: 'rgba(255,0,0,0.15)', borderTop: '2px dashed red'}} />
  </>
);

/** Absolutely positioned, horizontally centred block. */
export const Center: React.FC<{y: number; style?: React.CSSProperties; children: React.ReactNode}> = ({y, style, children}) => (
  <div style={{position: 'absolute', left: 0, width: W, top: y, display: 'flex', flexDirection: 'column', alignItems: 'center', ...style}}>{children}</div>
);

// ---- header: big hook on frame 0, settles to the top ---------------------------

export const Header: React.FC<{t: number; title: string; badge?: string; settleAt: number; hideAt?: number}> = ({t, title, badge, settleAt, hideAt = Infinity}) => {
  const s = prog(t, settleAt, 0.7);
  const out = 1 - prog(t, hideAt, 0.5);
  const y = lerp(560, SAFE.top + 40, s);
  const size = lerp(96, 60, s);
  return (
    <Center y={y} style={{opacity: out, filter: out < 0.999 ? `blur(${(1 - out) * 8}px)` : undefined}}>
      <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: size, lineHeight: 1.08, textAlign: 'center', maxWidth: W - 2 * SAFE.side, letterSpacing: '-0.01em', textWrap: 'balance'} as React.CSSProperties}>
        {title}
      </div>
      {badge ? <Badge style={{marginTop: lerp(34, 20, s)}}>{badge}</Badge> : null}
    </Center>
  );
};

export const Badge: React.FC<{children: React.ReactNode; tone?: 'accent' | 'muted'; style?: React.CSSProperties}> = ({children, tone = 'accent', style}) => (
  <div
    style={{
      padding: '12px 26px',
      borderRadius: 999,
      background: tone === 'accent' ? C.accentSoft : C.surfaceSoft,
      border: `2px solid ${tone === 'accent' ? C.accent : C.borderStrong}`,
      color: tone === 'accent' ? C.accent : C.muted,
      fontWeight: 800,
      fontSize: 30,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      ...style,
    }}
  >
    {children}
  </div>
);

// ---- round progress dots -------------------------------------------------------

export const Progress: React.FC<{n: number; current: number; t: number; appearAt: number; hideAt?: number}> = ({n, current, t, appearAt, hideAt}) => {
  const {style} = fade(t, appearAt, hideAt);
  return (
    <Center y={SAFE.top + 230} style={style}>
      <div style={{display: 'flex', gap: 16}}>
        {Array.from({length: n}, (_, i) => (
          <div
            key={i}
            style={{
              width: i === current ? 44 : 16,
              height: 16,
              borderRadius: 8,
              background: i < current ? C.accent : i === current ? C.text : C.borderStrong,
              transition: 'none',
            }}
          />
        ))}
      </div>
    </Center>
  );
};

// ---- countdown ring --------------------------------------------------------------

export const Countdown: React.FC<{t: number; start: number; seconds: number; y: number}> = ({t, start, seconds, y}) => {
  const vis = Math.min(prog(t, start - 0.1, 0.35), 1 - prog(t, start + seconds - 0.05, 0.3));
  if (vis <= 0.001) return null;
  const left = clamp01(1 - (t - start) / seconds);
  const n = Math.max(1, Math.ceil(seconds * left - 1e-6)); // whole seconds left, even for 1.5s timers
  const r = 62;
  const len = 2 * Math.PI * r;
  return (
    <Center y={y - 80} style={fxStyle(vis)}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        <circle cx={80} cy={80} r={r} fill={C.surface} stroke={C.border} strokeWidth={10} />
        <circle
          cx={80}
          cy={80}
          r={r}
          fill="none"
          stroke={C.accent}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - left)}
          transform="rotate(-90 80 80)"
        />
        <text x={80} y={80} textAnchor="middle" dominantBaseline="central" fill={C.text} fontFamily={SANS} fontWeight={800} fontSize={60}>
          {n}
        </text>
      </svg>
    </Center>
  );
};

// ---- pictures ----------------------------------------------------------------------

export const Flag: React.FC<{code: string; maxW: number; maxH: number; glow?: number; style?: React.CSSProperties}> = ({code, maxW, maxH, glow = 0, style}) => (
  <Img
    src={staticFile(`locato/flags/${code.toLowerCase()}.svg`)}
    style={{
      maxWidth: maxW,
      maxHeight: maxH,
      width: 'auto',
      height: 'auto',
      minWidth: Math.min(maxW, maxH * 1.2),
      objectFit: 'contain',
      borderRadius: 14,
      boxShadow: `0 0 0 3px ${glow > 0 ? `rgba(185,209,143,${0.25 + 0.75 * glow})` : C.border}, 0 30px 80px rgba(0,0,0,0.45)`,
      ...style,
    }}
  />
);

/** Country outline tinted in the game's text colour (the SVG is used as a mask). */
export const Shape: React.FC<{code: string; size: number; color?: string; style?: React.CSSProperties}> = ({code, size, color = C.text, style}) => {
  const url = `url(${staticFile(`locato/shapes/${code.toLowerCase()}.svg`)})`;
  return (
    <div
      style={{
        width: size,
        height: size,
        background: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        filter: 'drop-shadow(0 20px 50px rgba(0,0,0,0.5))',
        ...style,
      }}
    />
  );
};

export const LogoMark: React.FC<{size: number; color?: string}> = ({size, color = C.accent}) => {
  const url = `url(${staticFile('locato/logo.svg')})`;
  return <div style={{width: size, height: size, background: color, WebkitMaskImage: url, maskImage: url, WebkitMaskSize: 'contain', maskSize: 'contain'}} />;
};

// ---- outro: question, then end card -----------------------------------------------------

export const OUTRO_Q = 2.2;

export const NOTE = {
  score: 'Comment your score 👇',
  time: 'Comment your best time 👇',
  race: 'Tag who you’d race 👇',
};

export const OutroAndEnd: React.FC<{t: number; at: number; outro?: Outro; defaultCta: string; qLen?: number; defaultNote?: string}> = ({t, at, outro, defaultCta, qLen = OUTRO_Q, defaultNote = NOTE.score}) => {
  const qAt = at;
  const endAt = outro?.question ? at + qLen : at;
  const q = outro?.question ? fade(t, qAt, endAt - 0.1) : null;
  const end = fade(t, endAt);
  return (
    <>
      {q && q.p > 0.001 ? (
        <Center y={760} style={q.style}>
          <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 84, textAlign: 'center', maxWidth: W - 2 * SAFE.side, lineHeight: 1.1, textWrap: 'balance'} as React.CSSProperties}>{outro!.question}</div>
          <div style={{marginTop: 34, color: C.muted, fontSize: 40, fontWeight: 700}}>{outro?.note ?? defaultNote}</div>
        </Center>
      ) : null}
      {end.p > 0.001 ? (
        <Center y={640} style={end.style}>
          <LogoMark size={150} />
          <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 120, marginTop: 18, letterSpacing: '-0.02em'}}>locato</div>
          <div style={{marginTop: 26, padding: '18px 40px', borderRadius: 999, background: C.accent, color: '#1b3023', fontWeight: 800, fontSize: 48}}>{URL_TEXT}</div>
          <div style={{marginTop: 30, color: C.muted, fontWeight: 700, fontSize: 38, textAlign: 'center', maxWidth: W - 2 * SAFE.side}}>{outro?.cta ?? defaultCta}</div>
        </Center>
      ) : null}
    </>
  );
};

/** Answer line that rises in on reveal. */
export const Answer: React.FC<{t: number; at: number; outAt: number; text: string; note?: string; y: number}> = ({t, at, outAt, text, note, y}) => {
  const p = Math.min(prog(t, at, 0.45), 1 - prog(t, outAt, 0.35));
  if (p <= 0.001) return null;
  return (
    <Center y={y - 70 + (1 - p) * 24} style={{opacity: p, filter: p < 0.999 ? `blur(${(1 - p) * 8}px)` : undefined}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
        <Check size={64} p={ease((t - at - 0.15) / 0.4)} />
        <div style={{fontWeight: 800, fontSize: text.length > 18 ? 64 : 80, letterSpacing: '-0.01em', textAlign: 'center'}}>{text}</div>
      </div>
      {note ? <div style={{marginTop: 14, color: C.muted, fontWeight: 700, fontSize: 36}}>{note}</div> : null}
    </Center>
  );
};

export const Check: React.FC<{size: number; p: number}> = ({size, p}) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <circle cx={32} cy={32} r={30} fill={C.accent} opacity={0.18 + 0.82 * clamp01(p)} />
    <path d="M18 33 L28 43 L46 22" fill="none" stroke="#1b3023" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={50} strokeDashoffset={50 * (1 - clamp01(p))} />
  </svg>
);

export {H};
