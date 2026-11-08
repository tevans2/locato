import React from 'react';
import {Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {C, SAFE, SERIF, W, MUSIC} from '../brand';
import {fade, prog} from '../anim';
import {Badge, Center, Frame, Header, NOTE, OutroAndEnd, Sfx, outroCues, VoiceTrack, voiceSpans, type VoiceCue} from '../components';
import {clipLen, outroLens, versusResultLen, type Player, type VersusProps} from '../schema';
import {ClipCard} from './Clip';

// Two recordings of the same race, stacked, then the winner.
export const Versus: React.FC<VersusProps & {guides?: boolean}> = (p) => {
  const {fps} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const raceEnd = Math.max(clipLen(p.top.clip), clipLen(p.bottom.clip));
  const resultAt = raceEnd;
  const endAt = raceEnd + versusResultLen(p);
  const {q} = outroLens(p);
  const voice: VoiceCue[] = [
    {at: 0.15, clip: p.voice?.hook},
    {at: resultAt + 0.35, clip: p.voice?.result},
    {at: endAt + 0.35, clip: p.voice?.outro},
    {at: endAt + 0.2 + q + 0.15, clip: p.voice?.cta},
  ];
  const vis = fade(t, -1, endAt, 0.5);
  const won = prog(t, resultAt, 0.6);
  const areaTop = SAFE.top + 200;
  const areaBottom = SAFE.bottom - 20;
  const gap = 90;
  // Phone recordings sit side by side; desktop recordings stack.
  const portrait = p.top.clip.height > p.top.clip.width;
  const fullW = W - 2 * (SAFE.side - 30);
  const boxes = portrait
    ? [0, 1].map((i) => ({x: SAFE.side - 30 + i * ((fullW + gap) / 2), y: areaTop, w: (fullW - gap) / 2, h: areaBottom - areaTop}))
    : [0, 1].map((i) => ({x: SAFE.side - 30, y: areaTop + i * ((areaBottom - areaTop + gap) / 2), w: fullW, h: (areaBottom - areaTop - gap) / 2}));
  const vsAt = portrait ? {x: W / 2, y: (areaTop + areaBottom) / 2} : {x: W / 2, y: areaTop + boxes[0].h + gap / 2};
  const panel = (who: 'top' | 'bottom', pl: Player, box: {x: number; y: number; w: number; h: number}) => {
    const isWinner = p.winner === who;
    const isLoser = p.winner && !isWinner;
    return (
      <ClipCard m={pl.clip} box={box} highlight={isWinner ? won : 0} dim={isLoser ? won : 0}>
        <div style={{position: 'absolute', left: 14, right: 14, top: 14, display: 'flex', justifyContent: 'flex-start'}}>
          <div style={{display: 'flex', gap: 12, alignItems: 'center', padding: '8px 20px', borderRadius: 999, background: 'rgba(21,30,24,0.86)', border: `2px solid ${C.border}`, fontWeight: 800, fontSize: 30, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden'}}>
            {pl.emoji ? <span>{pl.emoji}</span> : null}
            <span>{pl.name}</span>
          </div>
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: won, scale: String(0.92 + 0.08 * won)}}>
          {isWinner ? <Badge>Winner</Badge> : null}
          {pl.result ? <div style={{padding: '8px 22px', borderRadius: 999, background: 'rgba(21,30,24,0.86)', color: C.accent, fontWeight: 800, fontSize: 34, whiteSpace: 'nowrap'}}>{pl.result}</div> : null}
        </div>
      </ClipCard>
    );
  };
  return (
    <Frame t={t} music={p.music} defaultMusic={MUSIC.versus} duck={voiceSpans(voice)} guides={p.guides}>
      <Header t={t} title={p.title} badge={p.badge} settleAt={-1} hideAt={endAt} />
      <Sequence durationInFrames={Math.ceil((endAt + 0.6) * fps)} layout="none">
        <div style={{position: 'absolute', inset: 0, ...vis.style}}>
          {panel('top', p.top, boxes[0])}
          {panel('bottom', p.bottom, boxes[1])}
          <Center y={vsAt.y - 38}>
            <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 64, color: C.accent}}>vs</div>
          </Center>
        </div>
      </Sequence>
      <OutroAndEnd t={t} at={endAt + 0.2} qLen={q || undefined} defaultNote={NOTE.race} outro={p.outro} defaultCta="Race your friends live. No download." />
      <VoiceTrack cues={voice} />
      <Sfx
        on={p.effects !== false}
        cues={[
          ...(p.winner ? [{at: resultAt, sound: 'victory' as const}] : []),
          ...outroCues(endAt + 0.2, p.outro, q || undefined).map((c) => (c.sound === 'victory' && p.winner ? {...c, sound: 'ping' as const} : c)),
        ]}
      />
    </Frame>
  );
};
