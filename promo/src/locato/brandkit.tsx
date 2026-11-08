import React from 'react';
import {AbsoluteFill} from 'remotion';
import {C, SANS, SERIF, URL_TEXT} from './brand';
import {Flag, LogoMark} from './components';

// Profile images in the same look as the videos: Locato's dark green, faint grid, accent pin, Fraunces wordmark.

const Bg: React.FC<{children: React.ReactNode; grid?: number}> = ({children, grid = 60}) => (
  <AbsoluteFill style={{background: C.bg, fontFamily: SANS, color: C.text, overflow: 'hidden'}}>
    <AbsoluteFill
      style={{
        background: `linear-gradient(${C.grid} 2px, transparent 2px) 0 0 / ${grid}px ${grid}px, linear-gradient(90deg, ${C.grid} 2px, transparent 2px) 0 0 / ${grid}px ${grid}px`,
      }}
    />
    <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 46%, rgba(185,209,143,0.16) 0%, transparent 55%)'}} />
    {children}
  </AbsoluteFill>
);

/** Square avatar (TikTok, Instagram, YouTube crop it to a circle): the pin, big and centred. */
export const Avatar: React.FC = () => (
  <Bg grid={72}>
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      {/* big and simple: it has to read at 40px in a comment thread */}
      <LogoMark size={700} />
    </AbsoluteFill>
  </Bg>
);

const STRIP = ['jp', 'br', 'za', 'ca', 'in', 'fr', 'au', 'mx', 'ke', 'kr', 'it', 'ar'];

/** YouTube banner 2560×1440; everything important sits in the 1546×423 area that shows on every device. */
export const Banner: React.FC = () => (
  <Bg grid={80}>
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div style={{width: 1546, height: 423, display: 'flex', alignItems: 'center', gap: 56, justifyContent: 'center'}}>
        <LogoMark size={210} />
        <div>
          <div style={{fontFamily: SERIF, fontWeight: 700, fontSize: 150, lineHeight: 1, letterSpacing: '-0.02em'}}>locato</div>
          <div style={{marginTop: 18, fontWeight: 700, fontSize: 46, color: C.muted}}>Geography challenges. Can you get 5/5?</div>
          <div style={{marginTop: 24, display: 'inline-block', padding: '12px 30px', borderRadius: 999, background: C.accent, color: '#1b3023', fontWeight: 800, fontSize: 38}}>{URL_TEXT}</div>
        </div>
      </div>
    </AbsoluteFill>
    {/* a quiet row of flags above and below the safe area, visible on TVs and wide screens */}
    {[230, 1110].map((top, row) => (
      <div key={top} style={{position: 'absolute', top, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 44, opacity: 0.35}}>
        {STRIP.slice(row * 3).concat(STRIP.slice(0, row * 3)).map((c) => (
          <Flag key={c} code={c} maxW={150} maxH={100} />
        ))}
      </div>
    ))}
  </Bg>
);

/** Instagram highlight cover (1080×1920, shown as a circle): an icon per series. */
export const HighlightCover: React.FC<{label: string; code?: string}> = ({label, code}) => (
  <Bg grid={72}>
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 40}}>
      <div style={{width: 640, height: 640, borderRadius: '50%', background: C.surface, border: `8px solid ${C.accent}`, display: 'grid', placeItems: 'center'}}>
        {code ? <Flag code={code} maxW={380} maxH={260} /> : <LogoMark size={340} />}
      </div>
      <div style={{fontWeight: 800, fontSize: 64, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.accent}}>{label}</div>
    </AbsoluteFill>
  </Bg>
);
