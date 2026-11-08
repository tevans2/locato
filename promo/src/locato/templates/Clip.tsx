import React from 'react';
import {Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Video} from '@remotion/media';
import {C, SAFE, W, MUSIC} from '../brand';
import {clamp01, ease, fade, fmtTime, lerp, prog} from '../anim';
import {Badge, Center, Frame, Header, NOTE, OutroAndEnd, Sfx, outroCues, type Cue, VoiceTrack, voiceSpans, type VoiceCue} from '../components';
import {clipLen, outroLens, type ClipProps, type Media} from '../schema';

/** A screen recording in a rounded card. `t` is video time; returns clip time too. */
export const ClipCard: React.FC<{
  m: Media;
  box: {x: number; y: number; w: number; h: number};
  zoom?: {x: number; y: number; scale: number};
  highlight?: number;
  dim?: number;
  children?: React.ReactNode;
}> = ({m, box, zoom, highlight = 0, dim = 0, children}) => {
  const {fps} = useVideoConfig();
  const k = Math.min(box.w / m.width, box.h / m.height);
  const w = m.width * k, h = m.height * k;
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 26, overflow: 'hidden', background: '#000',
        boxShadow: `0 0 0 ${3 + 3 * highlight}px ${highlight > 0 ? C.accent : C.borderStrong}, 0 40px 90px rgba(0,0,0,0.5)`,
      }}
    >
      <div style={{position: 'absolute', inset: 0, transformOrigin: zoom ? `${zoom.x * 100}% ${zoom.y * 100}%` : '50% 50%', scale: String(zoom?.scale ?? 1)}}>
        <Video
          src={staticFile(m.src)}
          trimBefore={Math.round((m.trimStart ?? 0) * fps)}
          playbackRate={m.playbackRate ?? 1}
          muted={m.muted ?? true}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </div>
      {dim > 0 ? <div style={{position: 'absolute', inset: 0, background: `rgba(10,15,12,${0.6 * dim})`}} /> : null}
      {children}
    </div>
  );
};

/** Clip-time zoom state from a list of eased push-ins (each eases in, holds, eases out). */
export const zoomAt = (ct: number, zooms: ClipProps['zooms'] = []) => {
  for (const z of zooms) {
    const ramp = Math.min(0.8, (z.end - z.start) / 3);
    const k = Math.min(ease((ct - z.start) / ramp), 1 - ease((ct - (z.end - ramp)) / ramp));
    if (k > 0) return {x: z.x, y: z.y, scale: lerp(1, z.scale, k)};
  }
  return undefined;
};

// Speedruns, records, feature demos: a recording with a hook title, running clock, captions, push-ins.
export const Clip: React.FC<ClipProps & {guides?: boolean}> = (p) => {
  const {fps} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const rate = p.clip.playbackRate ?? 1;
  const len = clipLen(p.clip);
  const ct = t * rate; // seconds into the (trimmed) clip
  const endAt = len + 0.4;
  const cardVis = fade(t, -1, endAt, 0.5);
  const {q} = outroLens(p);
  const voice: VoiceCue[] = [
    {at: 0.15, clip: p.voice?.hook},
    {at: endAt + 0.35, clip: p.voice?.outro},
    {at: endAt + 0.2 + q + 0.15, clip: p.voice?.cta},
  ];
  const box = {x: SAFE.side - 30, y: SAFE.top + 230, w: W - 2 * (SAFE.side - 30), h: SAFE.bottom - 170 - (SAFE.top + 230)};

  const timer = p.timer;
  const running = timer ? Math.min(Math.max(ct, timer.start), timer.stop) - timer.start : 0;
  const stopped = timer ? clamp01((ct - timer.stop) / 0.4) : 0;

  return (
    <Frame t={t} music={p.music} defaultMusic={MUSIC.speedrun} duck={voiceSpans(voice)} guides={p.guides}>
      <Header t={t} title={p.title} badge={p.badge} settleAt={-1} hideAt={endAt} />
      <Sequence durationInFrames={Math.ceil((endAt + 0.6) * fps)} layout="none">
        <div style={{position: 'absolute', inset: 0, ...cardVis.style}}>
          <ClipCard m={p.clip} box={box} zoom={zoomAt(ct, p.zooms)} highlight={stopped} />
        </div>
      </Sequence>
      {timer && t < endAt + 0.5 ? (
        <Center y={SAFE.bottom - 150} style={{opacity: Math.min(prog(t, 0.2, 0.4), 1 - prog(t, endAt, 0.5))}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 22, padding: '16px 34px', borderRadius: 999, background: stopped ? C.accent : C.surface, border: `2px solid ${C.accent}`, color: stopped ? '#1b3023' : C.text}}>
            <span style={{fontWeight: 800, fontSize: 30, letterSpacing: '0.18em', opacity: 0.8}}>{timer.label ?? 'TIME'}</span>
            <span style={{fontWeight: 800, fontSize: 64, fontVariantNumeric: 'tabular-nums'}}>{fmtTime(running * 1000)}</span>
          </div>
        </Center>
      ) : null}
      {(p.callouts ?? []).map((c, i) => {
        const at = c.at / rate, until = (c.at + (c.duration ?? 2.2)) / rate;
        const v = fade(t, at, until, 0.4);
        if (v.p <= 0.001) return null;
        return (
          <Center key={i} y={SAFE.bottom - 270} style={v.style}>
            <Badge tone="muted" style={{fontSize: 34, letterSpacing: '0.06em', textTransform: 'none', color: C.text}}>{c.text}</Badge>
          </Center>
        );
      })}
      <OutroAndEnd t={t} at={endAt + 0.2} qLen={q || undefined} defaultNote={NOTE.time} outro={p.outro} defaultCta="Free geography game. Play in your browser." />
      <VoiceTrack cues={voice} />
      <Sfx
        on={p.effects !== false}
        cues={[
          ...(p.callouts ?? []).map((c): Cue => ({at: c.at / rate, sound: 'ping'})),
          ...(timer ? [{at: timer.stop / rate, sound: 'victory'} as Cue] : []),
          ...outroCues(endAt + 0.2, p.outro, q || undefined).map((c) => (c.sound === 'victory' && timer ? {...c, sound: 'ping' as const} : c)),
        ]}
      />
    </Frame>
  );
};
