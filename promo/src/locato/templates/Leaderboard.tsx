import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {C, H, SAFE, SERIF, W, MUSIC} from '../brand';
import {ease, fade, fmtTime, prog} from '../anim';
import {Center, Frame, Header, NOTE, OutroAndEnd, Sfx, outroCues, type Cue, VoiceTrack, voiceSpans, type VoiceCue} from '../components';
import {BOARD, boardTiming, outroLens, type LeaderboardProps} from '../schema';

// Podium for the top 3, then the next rows one at a time, then "can you beat it?".
export const Leaderboard: React.FC<LeaderboardProps & {guides?: boolean}> = (p) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const fmt = (v: number) => (p.metric === 'time' ? fmtTime(v) : `${v.toLocaleString('en-US')}${p.maxScore ? ` / ${p.maxScore.toLocaleString('en-US')}` : ''}`);
  const top3 = p.entries.slice(0, 3);
  const rest = p.entries.slice(3);
  const {podiumAt, rowsAt, end} = boardTiming(p);
  const {q} = outroLens(p);
  const voice: VoiceCue[] = [
    {at: 0.15, clip: p.voice?.hook},
    {at: podiumAt + 2 * 0.55 + 0.5, clip: p.voice?.result}, // as first place lands
    {at: end + 0.35, clip: p.voice?.outro},
    {at: end + 0.2 + q + 0.15, clip: p.voice?.cta},
  ];
  const all = fade(t, -1, end, 0.5);

  // podium: 2nd, 1st, 3rd from left to right; each rises one after another (3rd, 2nd, 1st)
  const slots = [
    {e: top3[1], h: 230, order: 1},
    {e: top3[0], h: 310, order: 2},
    {e: top3[2], h: 170, order: 0},
  ];
  const podiumBase = 1000;
  const colW = (W - 2 * SAFE.side) / 3;
  return (
    <Frame t={t} music={p.music} defaultMusic={MUSIC.leaderboard} duck={voiceSpans(voice)} guides={p.guides}>
      <Header t={t} title={p.title} badge={p.badge} settleAt={Math.max(0.1, podiumAt - 0.7)} hideAt={end} />
      <div style={{position: 'absolute', inset: 0, ...all.style}}>
        {slots.map(({e, h, order}, i) => {
          if (!e) return null;
          const r = ease((t - podiumAt - order * 0.55) / 0.8);
          const x = SAFE.side + i * colW;
          const medal = e.rank === 1 ? '#e6c76a' : e.rank === 2 ? '#c9d0cc' : '#c98e5f';
          return (
            <div key={i} style={{position: 'absolute', left: x, width: colW, bottom: H - podiumBase, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: Math.min(1, r * 1.5)}}>
              <div style={{fontSize: e.rank === 1 ? 92 : 74, lineHeight: 1}}>{e.emoji ?? '🌍'}</div>
              <div style={{marginTop: 10, fontWeight: 800, fontSize: 32, maxWidth: colW - 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{e.name}</div>
              <div style={{marginTop: 4, color: C.accent, fontWeight: 800, fontSize: 36, fontVariantNumeric: 'tabular-nums'}}>{fmt(e.value)}</div>
              <div style={{marginTop: 14, width: colW - 26, height: h * r, borderRadius: '18px 18px 0 0', background: C.surface, border: `2px solid ${C.border}`, borderBottom: 'none', display: 'flex', justifyContent: 'center', paddingTop: 18}}>
                <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 76, color: medal}}>{e.rank}</div>
              </div>
            </div>
          );
        })}
        <div style={{position: 'absolute', left: SAFE.side, right: SAFE.side, top: podiumBase, height: 3, background: C.borderStrong}} />
        {rest.map((e, i) => {
          const v = prog(t, rowsAt + i * BOARD.rowStagger, 0.45);
          if (v <= 0.001) return null;
          return (
            <div key={e.rank} style={{position: 'absolute', left: SAFE.side, right: SAFE.side, top: podiumBase + 40 + i * 76, height: 64, display: 'flex', alignItems: 'center', gap: 22, padding: '0 26px', borderRadius: 16, background: i % 2 ? 'transparent' : C.surface, opacity: v, translate: `0 ${(1 - v) * 16}px`, filter: v < 0.999 ? `blur(${(1 - v) * 6}px)` : undefined}}>
              <span style={{width: 50, color: C.muted, fontWeight: 800, fontSize: 32}}>{e.rank}</span>
              <span style={{fontSize: 34}}>{e.emoji ?? '🌍'}</span>
              <span style={{flex: 1, fontWeight: 700, fontSize: 32, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{e.name}</span>
              <span style={{fontWeight: 800, fontSize: 32, color: C.text, fontVariantNumeric: 'tabular-nums'}}>{fmt(e.value)}</span>
            </div>
          );
        })}
      </div>
      <OutroAndEnd t={t} at={end + 0.2} qLen={q || undefined} defaultNote={p.metric === 'time' ? NOTE.time : NOTE.score.replace('score', 'best score')} outro={p.outro} defaultCta="Can you get on the board?" />
      <VoiceTrack cues={voice} />
      <Sfx
        on={p.effects !== false}
        cues={[
          ...top3.map((_, k): Cue => ({at: podiumAt + k * 0.55 + 0.15, sound: k === 2 ? 'correct' : 'ping'})),
          ...rest.map((_, i): Cue => ({at: rowsAt + i * BOARD.rowStagger, sound: 'tick', volume: 0.35})),
          ...outroCues(end + 0.2, p.outro, q || undefined),
        ]}
      />
    </Frame>
  );
};

export {Center};
