import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {C, SAFE, W, MUSIC} from '../brand';
import {fade, prog} from '../anim';
import {Center, Countdown, Flag, Frame, Header, OutroAndEnd, Progress, Sfx, Shape, VoiceTrack, outroCues, voiceSpans, type Cue, type VoiceCue} from '../components';
import {LOOK, lookTiming, type LookalikeSet, type LookalikesProps} from '../schema';

// "Can you tell these apart?": unlabeled look-alikes → think → names + the tell-tale difference.
export const Lookalikes: React.FC<LookalikesProps & {guides?: boolean}> = (p) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const T = lookTiming(p);
  const len = T.setLen;
  const secs = T.secs;
  const end = T.setsEnd;
  const outroAt = end + 0.2;
  const current = Math.min(p.sets.length - 1, Math.max(0, Math.floor((t - T.intro) / len)));
  const voice: VoiceCue[] = [
    {at: 0.15, clip: p.voice?.hook},
    ...p.sets.map((_, i) => ({at: T.intro + i * len + LOOK.enter + secs + 0.15, clip: p.voice?.answers?.[i]})),
    {at: outroAt + 0.15, clip: p.voice?.outro},
    {at: outroAt + T.q + 0.15, clip: p.voice?.cta},
  ];
  return (
    <Frame t={t} music={p.music} defaultMusic={MUSIC.lookalikes} duck={voiceSpans(voice)} guides={p.guides}>
      <Header t={t} title={p.title} badge={p.badge} settleAt={Math.max(0.1, T.intro - 0.65)} hideAt={end} />
      <Progress n={p.sets.length} current={current} t={t} appearAt={T.intro - 0.3} hideAt={end} />
      {p.sets.map((s, i) => {
        const start = T.intro + i * len;
        return <SetView key={i} t={t} s={s} start={start} think={secs} outAt={start + len - 0.3} />;
      })}
      <OutroAndEnd t={t} at={outroAt} qLen={T.q || undefined} outro={p.outro} defaultCta="Train your eye in Locato's Academy." />
      <VoiceTrack cues={voice} />
      <Sfx
        on={p.effects !== false}
        cues={[
          ...p.sets.flatMap((_, i): Cue[] => {
            const s = T.intro + i * len;
            const think = s + LOOK.enter;
            return [
              {at: s - 0.05, sound: 'whoosh'},
              ...Array.from({length: secs}, (_, k): Cue => ({at: think + k, sound: 'tick'})),
              {at: think + secs, sound: 'correct'},
            ];
          }),
          ...outroCues(outroAt, p.outro, T.q || undefined),
        ]}
      />
    </Frame>
  );
};

const TOP = SAFE.top + 330; // below header, dots and the names line
const BOTTOM = 1385; // tip area starts here

const SetView: React.FC<{t: number; s: LookalikeSet; start: number; think: number; outAt: number}> = ({t, s, start, think, outAt}) => {
  const vis = fade(t, start, outAt, 0.5);
  if (vis.p <= 0.001) return null;
  const revealAt = start + LOOK.enter + think;
  const rev = Math.min(prog(t, revealAt, 0.5), 1 - prog(t, outAt, 0.35));
  const n = s.items.length;
  const grid = n >= 4; // 2×2
  const rows = grid ? 2 : n;
  const cols = grid ? 2 : 1;
  const cellH = (BOTTOM - TOP - 40) / rows;
  const cellW = (W - 2 * SAFE.side) / cols;
  const picH = cellH - 66; // room for the label
  const picW = cellW - 40;
  const order = s.items.map((it) => it.name).slice().sort(); // the question lists names alphabetically, not in picture order
  return (
    <>
      {/* names to match, shown while thinking */}
      <Center y={TOP - 72} style={{opacity: vis.p * (1 - rev)}}>
        <div style={{color: C.muted, fontWeight: 700, fontSize: 36}}>{order.join('  ·  ')}</div>
      </Center>
      <div style={{position: 'absolute', left: SAFE.side, top: TOP, width: W - 2 * SAFE.side, height: BOTTOM - TOP, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, ...vis.style}}>
        {s.items.map((it, i) => (
          <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
            {s.skill === 'flag' ? <Flag code={it.code} maxW={picW} maxH={picH} glow={rev} /> : <Shape code={it.code} size={Math.min(picW, picH)} />}
            <div style={{height: 70, marginTop: 14, fontWeight: 800, fontSize: 44, opacity: rev, filter: rev < 0.999 ? `blur(${(1 - rev) * 6}px)` : undefined, translate: `0 ${(1 - rev) * 14}px`}}>
              {it.name}
            </div>
          </div>
        ))}
      </div>
      <Countdown t={t} start={start + LOOK.enter} seconds={think} y={BOTTOM + 110} />
      <Center y={BOTTOM + 14} style={{opacity: rev, filter: rev < 0.999 ? `blur(${(1 - rev) * 6}px)` : undefined}}>
        <div style={{maxWidth: W - 2 * SAFE.side - 40, textAlign: 'center', color: C.text, fontWeight: 600, fontSize: 36, lineHeight: 1.35, padding: '22px 30px', borderRadius: 20, background: C.surface, border: `2px solid ${C.border}`}}>
          {s.tip}
        </div>
      </Center>
    </>
  );
};
