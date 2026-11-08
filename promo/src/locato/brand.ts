import {loadFont as loadManrope} from '@remotion/google-fonts/Manrope';
import {loadFont as loadFraunces} from '@remotion/google-fonts/Fraunces';

// Locato's dark theme (locato/src/styles/tokens.css) so videos look like the game.
export const C = {
  bg: '#151e18',
  surface: '#1c2820',
  surfaceSoft: '#26352a',
  border: 'rgba(226, 234, 225, 0.13)',
  borderStrong: 'rgba(226, 234, 225, 0.28)',
  text: '#efefdd',
  muted: '#adb9a6',
  accent: '#b9d18f',
  accentSoft: '#2c3e2b',
  good: '#8bd23f',
  bad: '#ef8069',
  grid: 'rgba(226, 234, 225, 0.045)',
};

export const SANS = loadManrope('normal', {weights: ['500', '700', '800'], subsets: ['latin', 'latin-ext']}).fontFamily;
export const SERIF = loadFraunces('normal', {weights: ['600', '700'], subsets: ['latin', 'latin-ext']}).fontFamily;

export const W = 1080;
export const H = 1920;
export const FPS = 60;
/** Keep important things out of the platform UI: top 8%, bottom 18%. */
export const SAFE = {top: Math.round(H * 0.08), bottom: Math.round(H * 0.82), side: 70};

export const URL_TEXT = 'locato.quest';

/** Default background track per template (Mixkit, see public/locato/music/LICENSES.md). */
export const MUSIC = {
  quiz: 'locato/music/gummies.m4a',
  daily: 'locato/music/placeit-world.m4a',
  lookalikes: 'locato/music/close-up.m4a',
  speedrun: 'locato/music/running-out-of-time.m4a',
  versus: 'locato/music/what-about-action.m4a',
  leaderboard: 'locato/music/motivating-mornings.m4a',
} as const;
export const MUSIC_VOLUME = 0.7;
