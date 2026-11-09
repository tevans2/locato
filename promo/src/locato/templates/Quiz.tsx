import React from 'react';
import {Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, MUSIC, SAFE, W} from '../brand';
import {clamp01, fade, prog} from '../anim';
import {Answer, Badge, Center, Countdown, Flag, Frame, Header, OutroAndEnd, Sfx, Shape, VoiceTrack, outroCues, voiceSpans, type Cue, type VoiceCue, mediaSrc} from '../components';
import {MAP_COLORS, WorldMap, type MapLabel, type Pin} from '../map';
import {QUIZ, quizTiming, type QuizProps, type QuizRound} from '../schema';

// The Score Challenge: one engine for every Locato mode (see QuizRound in schema.ts).
// Layout (1080×1920): title + badge at the top, the n/N counter, the round's question line,
// the stage (picture or map), then countdown → answer. Round 1 is visible from frame 0.

const STAGE = {top: 540, bottom: 1300}; // where pictures and maps live
const STAGE_H = STAGE.bottom - STAGE.top;
const STAGE_W = W - 2 * (SAFE.side - 30);
const ANSWER_Y = 1430;

export const Quiz: React.FC<QuizProps & {guides?: boolean}> = (p) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const T = quizTiming(p);
  const n = p.rounds.length;
  const outroAt = T.roundsEnd + 0.2;
  let current = 0;
  T.starts.forEach((s, i) => {
    if (t >= s - 0.01) current = i;
  });
  const voice: VoiceCue[] = [
    {at: 0.1, clip: p.voice?.hook},
    ...p.rounds.map((_, i) => ({at: T.reveals[i] + 0.1, clip: p.voice?.answers?.[i]})),
    {at: outroAt + 0.15, clip: p.voice?.outro},
    {at: outroAt + T.q + 0.15, clip: p.voice?.cta},
  ];
  const hud = fade(t, -1, T.roundsEnd - 0.1, 0.4);
  const r = p.rounds[current];
  return (
    <Frame t={t} music={p.music} defaultMusic={p.variant === 'daily' ? MUSIC.daily : MUSIC.quiz} duck={voiceSpans(voice)} guides={p.guides}>
      <Header t={t} title={p.title} badge={p.badge} settleAt={-1} hideAt={T.roundsEnd - 0.1} />
      {hud.p > 0.001 ? (
        <Center y={SAFE.top + 205} style={hud.style}>
          <div style={{display: 'flex', gap: 14, alignItems: 'center'}}>
            <Badge tone="muted" style={{fontSize: 30, color: C.text, letterSpacing: '0.08em'}}>
              {current + 1} / {n}
            </Badge>
            {p.mode === 'one-life' ? <Badge tone="muted" style={{fontSize: 30, color: C.bad, borderColor: C.bad, letterSpacing: '0.08em'}}>♥ 1 life</Badge> : null}
            {r?.boss ? <Badge style={{fontSize: 30, background: '#3b2a1c', borderColor: C.bad, color: '#f3b38f'}}>Boss</Badge> : null}
          </div>
        </Center>
      ) : null}
      {p.rounds.map((round, i) => (
        <Round key={i} t={t} r={round} first={i === 0} start={T.starts[i]} think={T.thinks[i]} reveal={T.reveals[i]} outAt={T.reveals[i] + T.holds[i] - QUIZ.overlap} />
      ))}
      <OutroAndEnd t={t} at={outroAt} qLen={T.q || undefined} outro={p.outro} defaultCta="Free geography game. Play in your browser." />
      <VoiceTrack cues={voice} />
      <Sfx
        on={p.effects !== false}
        cues={[
          ...p.rounds.flatMap((round, i): Cue[] => {
            const secs = T.reveals[i] - T.thinks[i];
            const ticks = Math.max(1, Math.round(secs));
            return [
              ...(i > 0 ? [{at: T.starts[i] - 0.05, sound: 'whoosh'} as Cue] : []),
              ...Array.from({length: ticks}, (_, k): Cue => ({at: T.thinks[i] + (k * secs) / ticks, sound: 'tick', volume: 0.55 + 0.1 * k})),
              {at: T.reveals[i], sound: 'correct'},
              ...(round.type === 'route' ? round.path.map((_, k): Cue => ({at: T.reveals[i] + 0.15 + k * 0.35, sound: 'tick', volume: 0.4})) : []),
            ];
          }),
          ...outroCues(outroAt, p.outro, T.q || undefined),
        ]}
      />
    </Frame>
  );
};

// ---- one round -------------------------------------------------------------------------------

const Round: React.FC<{t: number; r: QuizRound; first: boolean; start: number; think: number; reveal: number; outAt: number}> = ({t, r, first, start, think, reveal, outAt}) => {
  // Round 1 is fully on screen at frame 0 (the hook *is* the first question); the rest slide in.
  const inP = first ? 1 : prog(t, start, QUIZ.enter);
  const outP = prog(t, outAt, 0.3);
  const vis = Math.min(inP, 1 - outP);
  if (vis <= 0.001) return null;
  const slide = (1 - inP) * 70 - outP * 70;
  const rev = Math.min(prog(t, reveal, 0.4), 1 - outP); // 0 → 1 at the reveal
  const secs = reveal - think;
  const thinkP = clamp01((t - think) / secs); // 0 → 1 while thinking
  const promptLine = questionLine(r);
  return (
    <>
      <div style={{position: 'absolute', inset: 0, opacity: vis, translate: `${slide}px 0`, filter: vis < 0.999 ? `blur(${(1 - vis) * 6}px)` : undefined}}>
        {promptLine ? (
          <div style={{position: 'absolute', left: SAFE.side - 20, right: SAFE.side - 20, bottom: 1920 - STAGE.top + 16, textAlign: 'center'}}>
            {/* always one line (the font shrinks for long names), so it can never reach the counter above */}
            {r.type === 'route' ? (
              <>
                <div style={{fontWeight: 800, fontSize: fitFont(`${r.from.name} → ${r.to.name}`, 46), whiteSpace: 'nowrap', lineHeight: 1.1}}>{promptLine}</div>
                <div style={{fontWeight: 700, fontSize: 30, color: C.muted, marginTop: 2}}>Fewest countries between?</div>
              </>
            ) : (
              <div style={{fontWeight: 800, fontSize: fitFont(promptText(r), 46), whiteSpace: 'nowrap', lineHeight: 1.15}}>{promptLine}</div>
            )}
          </div>
        ) : null}
        <div style={{position: 'absolute', left: 0, width: W, top: STAGE.top, height: STAGE_H, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Stage r={r} t={t} rev={rev} thinkP={thinkP} reveal={reveal} />
        </div>
      </div>
      <Countdown t={t} start={think} seconds={secs} y={ANSWER_Y} />
      <Answer t={t} at={reveal} outAt={outAt} text={r.answer} note={r.note} y={ANSWER_Y} />
    </>
  );
};

/** Plain text of the question line, for sizing. */
const promptText = (r: QuizRound) =>
  r.prompt ?? (r.type === 'find' ? `Where is ${r.country}?` : r.type === 'pin' ? `Where is ${r.place}?` : r.type === 'capital' ? `Capital of ${r.country}?` : 'Which side has more people?');
/** Largest font (up to max) that keeps the text on one line across the frame (~0.56em per character). */
const fitFont = (text: string, max: number) => Math.max(26, Math.min(max, (W - 2 * (SAFE.side - 20)) / (text.length * 0.56)));

const accent = (s: string) => <span style={{color: C.accent}}>{s}</span>;

const questionLine = (r: QuizRound): React.ReactNode => {
  if (r.prompt) return r.prompt;
  switch (r.type) {
    case 'capital':
      return <>Capital of {accent(r.country)}?</>;
    case 'capital-of':
      return 'Whose capital is this?';
    case 'code':
      return 'Which country has this code?';
    case 'colours':
      return 'Name it before the last colour';
    case 'which':
      return 'Which one is it?';
    case 'spot':
      return 'Name the lit-up country';
    case 'find':
      return <>Where is {accent(r.country)}?</>;
    case 'pin':
      return <>Where is {accent(r.place)}?</>;
    case 'route':
      return <>{accent(r.from.name)} → {accent(r.to.name)}</>;
    case 'split':
      return 'Which side has more people?';
    default:
      return null;
  }
};

// ---- what's on the stage ---------------------------------------------------------------------

const Stage: React.FC<{r: QuizRound; t: number; rev: number; thinkP: number; reveal: number}> = ({r, t, rev, thinkP, reveal}) => {
  switch (r.type) {
    case 'flag':
      return <Flag code={r.code} maxW={880} maxH={600} glow={rev} />;
    case 'shape':
      return <Shape code={r.code} size={760} color={rev > 0 ? mixHex(C.text, C.accent, rev) : C.text} />;
    case 'capital':
      return <Flag code={r.code} maxW={720} maxH={460} glow={rev} />;
    case 'capital-of':
      return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <div style={{fontWeight: 800, fontSize: 120, textAlign: 'center', maxWidth: W - 2 * SAFE.side, lineHeight: 1.05}}>{r.note}</div>
          <div style={{opacity: rev, scale: String(0.9 + 0.1 * rev)}}>
            <Flag code={r.code} maxW={460} maxH={290} glow={rev} />
          </div>
        </div>
      );
    case 'code':
      return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 50}}>
          <div style={{padding: '40px 70px 40px 100px', borderRadius: 36, background: C.surface, border: `3px solid ${rev > 0 ? C.accent : C.borderStrong}`, fontWeight: 800, fontSize: 230, letterSpacing: '0.12em'}}>
            {r.code}
          </div>
          <div style={{opacity: rev, scale: String(0.9 + 0.1 * rev)}}>
            <Flag code={r.code} maxW={400} maxH={250} glow={rev} />
          </div>
        </div>
      );
    case 'colours': {
      // stages[0] has no colours; each later stage adds one; the last stage is the real flag.
      const n = r.stages.length - 1;
      const pos = rev > 0 ? n : thinkP * n;
      const k = rev > 0 ? n : Math.min(n - 1, Math.floor(pos));
      const nextP = rev > 0 ? 1 : clamp01((pos - Math.floor(pos)) * 4);
      const img: React.CSSProperties = {gridArea: '1/1', maxWidth: 880, maxHeight: 600, borderRadius: 14};
      return (
        <div style={{display: 'grid', placeItems: 'center', boxShadow: `0 0 0 ${3 + 3 * rev}px ${rev > 0 ? C.accent : C.border}`, borderRadius: 14}}>
          <Img src={mediaSrc(r.stages[Math.max(0, k - 1)])} style={img} />
          <Img src={mediaSrc(r.stages[k])} style={{...img, opacity: k === 0 ? 1 : nextP}} />
        </div>
      );
    }
    case 'which':
      return (
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 56}}>
          {r.skill === 'flag' ? <Flag code={r.code} maxW={820} maxH={460} glow={rev} /> : <Shape code={r.code} size={520} />}
          <div style={{display: 'flex', gap: 22, flexWrap: 'wrap', justifyContent: 'center', maxWidth: W - 2 * SAFE.side}}>
            {r.options.map((o) => {
              const right = o === r.answer;
              return (
                <div
                  key={o}
                  style={{
                    padding: '18px 34px',
                    borderRadius: 999,
                    fontWeight: 800,
                    fontSize: 42,
                    background: right && rev > 0 ? C.accent : C.surface,
                    color: right && rev > 0 ? '#1b3023' : C.text,
                    border: `3px solid ${right && rev > 0 ? C.accent : C.borderStrong}`,
                    opacity: right ? 1 : 1 - 0.65 * rev,
                    scale: String(right ? 1 + 0.06 * rev : 1),
                  }}
                >
                  {o}
                </div>
              );
            })}
          </div>
        </div>
      );
    default:
      return <MapStage r={r} t={t} rev={rev} thinkP={thinkP} reveal={reveal} />;
  }
};

const MapStage: React.FC<{r: QuizRound; t: number; rev: number; thinkP: number; reveal: number}> = ({r, t, rev, thinkP, reveal}) => {
  if (!('view' in r)) return null;
  const fills: Record<string, {color: string; p: number}> = {};
  const pins: Pin[] = [];
  const labels: MapLabel[] = [];
  let split: React.ComponentProps<typeof WorldMap>['split'];
  // a slight push-in keeps the map alive while you think
  const [x0, y0, x1, y1] = r.view;
  const sh = (x1 - x0) * 0.03, sv = (y1 - y0) * 0.03;
  const viewEnd: [number, number, number, number] = [x0 + sh, y0 + sv, x1 - sh, y1 - sv];
  const push = clamp01(thinkP * 0.8 + rev * 0.2);
  switch (r.type) {
    case 'spot':
      fills[r.code] = {color: MAP_COLORS.hi, p: 1};
      break;
    case 'find':
      fills[r.code] = {color: MAP_COLORS.hi, p: rev};
      pins.push({x: r.c[0], y: r.c[1], p: rev});
      break;
    case 'pin':
      pins.push({x: r.x, y: r.y, p: rev});
      labels.push({x: r.x, y: r.y + (y1 - y0) * 0.07, text: r.place, p: rev});
      break;
    case 'route':
      fills[r.from.code] = {color: MAP_COLORS.hi, p: 1};
      fills[r.to.code] = {color: MAP_COLORS.hi, p: 1};
      r.path.forEach((s, k) => {
        fills[s.code] = {color: MAP_COLORS.route, p: clamp01((t - reveal - 0.15 - k * 0.35) / 0.3)};
      });
      labels.push({x: r.from.c[0], y: r.from.c[1], text: r.from.name, p: 1, size: 30});
      labels.push({x: r.to.c[0], y: r.to.c[1], text: r.to.name, p: 1, size: 30});
      break;
    case 'split': {
      split = {a: r.a, b: r.b, p: clamp01(thinkP * 3), shade: rev, polyA: r.sideA.poly, polyB: r.sideB.poly};
      const total = r.sideA.pop + r.sideB.pop;
      const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
      // keep labels inside the frame
      const m = (x1 - x0) * 0.16, mv = (y1 - y0) * 0.1;
      const at = (q: [number, number]): [number, number] => [Math.min(Math.max(q[0], x0 + m), x1 - m), Math.min(Math.max(q[1], y0 + mv), y1 - mv)];
      const [ax, ay] = at(r.sideA.at), [bx, by] = at(r.sideB.at);
      labels.push({x: ax, y: ay, text: `${r.sideA.label} ${pct(r.sideA.pop)}`, p: rev, size: 50, color: '#9cc4ea'});
      labels.push({x: bx, y: by, text: `${r.sideB.label} ${pct(r.sideB.pop)}`, p: rev, size: 50, color: '#f3a08c'});
      break;
    }
  }
  return (
    <div style={{borderRadius: 30, overflow: 'hidden', boxShadow: `0 0 0 3px ${rev > 0 ? C.accent : C.borderStrong}, 0 30px 80px rgba(0,0,0,0.45)`}}>
      <WorldMap w={STAGE_W} h={STAGE_H} view={r.view} viewEnd={viewEnd} push={push} fills={fills} pins={pins} labels={labels} split={split} />
    </div>
  );
};

const mixHex = (a: string, b: string, k: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp01(k)).toString(16).padStart(2, '0')).join('');
};
