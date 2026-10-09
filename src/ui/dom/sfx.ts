import { readSettings, saveSettings } from "../../storage/settings";

/**
 * Browser sound effects + screen-flash feedback, synthesized with the Web Audio API so the
 * game ships no audio assets. Every play call is a no-op until a user gesture resumes the
 * (autoplay-gated) AudioContext, and all of them honor the persisted `soundEnabled` setting.
 */

export const SOUND_CHANGE_EVENT = "locato:sound-change";

export type FlashTone = "good" | "bad";

let enabled = true;
try {
  if (typeof window !== "undefined" && window.localStorage) {
    enabled = readSettings(window.localStorage).soundEnabled;
  }
} catch {
  // Storage unavailable — default to audible.
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let resumeBound = false;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  // Safari exposes the constructor under its vendor prefix.
  const legacyWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? legacyWindow.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try { context = new Ctor(); } catch { return null; }
    master = context.createGain();
    // Keep everything gentle; these are cues, not music.
    master.gain.value = enabled ? 0.16 : 0;
    master.connect(context.destination);
  }
  // Autoplay policies start the context suspended. Browsers lift the gate on the next
  // gesture, so piggyback resume on pointer/key input; resume() is idempotent and the
  // listeners stay bound because tabs can re-suspend after backgrounding.
  if (context.state === "suspended" && !resumeBound) {
    resumeBound = true;
    const resume = (): void => {
      void context?.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume, { passive: true });
  }
  return context;
}

interface ToneOptions {
  readonly type?: OscillatorType;
  readonly gain?: number;
  readonly endFrequency?: number;
  readonly attack?: number;
}

function tone(frequency: number, offsetSeconds: number, durationSeconds: number, options: ToneOptions = {}): () => void {
  const audio = ensureContext();
  if (!audio || !master || audio.state !== "running") return () => {};
  const start = audio.currentTime + offsetSeconds;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = options.type ?? "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, start + durationSeconds);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 1, start + (options.attack ?? 0.012));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(start + durationSeconds + 0.05);
  const disconnect = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.onended = disconnect;
  return () => { try { oscillator.stop(); } catch { /* Already stopped. */ } disconnect(); };
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  if (master && context) master.gain.setValueAtTime(value ? 0.16 : 0, context.currentTime);
  try {
    saveSettings(window.localStorage, { ...readSettings(window.localStorage), soundEnabled: value });
  } catch {
    // Persistence is best-effort; the toggle still applies for this visit.
  }
  window.dispatchEvent(new CustomEvent<boolean>(SOUND_CHANGE_EVENT, { detail: value }));
}

/** Rising three-note arpeggio: the local player answered correctly / took the round. */
export function playCorrect(): void {
  if (!enabled) return;
  tone(523.25, 0, 0.14);
  tone(659.25, 0.08, 0.14);
  tone(783.99, 0.16, 0.24);
}

/** Soft single ping: another player took the round. */
export function playRoundTaken(): void {
  if (!enabled) return;
  tone(880, 0, 0.12, { type: "sine", gain: 0.8 });
  tone(1174.66, 0.09, 0.16, { type: "sine", gain: 0.5 });
}

/** Low descending buzz: wrong answer or rejected guess. */
export function playWrong(): void {
  if (!enabled) return;
  tone(196, 0, 0.16, { type: "square", gain: 0.5 });
  tone(138.59, 0.11, 0.26, { type: "square", gain: 0.45 });
}

/** Descending "nobody got it" sting when a timed round expires unanswered. */
export function playTimeUp(): void {
  if (!enabled) return;
  tone(440, 0, 0.14, { type: "sawtooth", gain: 0.5 });
  tone(329.63, 0.15, 0.14, { type: "sawtooth", gain: 0.5 });
  tone(220, 0.3, 0.32, { type: "sawtooth", gain: 0.55 });
}

/** Short victory fanfare for game completion. */
export function playVictory(): void {
  if (!enabled) return;
  tone(523.25, 0, 0.12);
  tone(659.25, 0.09, 0.12);
  tone(783.99, 0.18, 0.12);
  tone(1046.5, 0.27, 0.34);
}

/** Quiet clock tick for the final seconds of a round. */
export function playTick(): void {
  if (!enabled) return;
  tone(1318.51, 0, 0.05, { type: "sine", gain: 0.35 });
}

let flashElement: HTMLElement | null = null;

/**
 * Flashes a full-viewport outline in the given tone. Independent of the sound setting —
 * it doubles as visual feedback when audio is muted — and CSS shortens it under
 * `prefers-reduced-motion`.
 */
export function flashScreen(tone: FlashTone): void {
  if (typeof document === "undefined") return;
  if (!flashElement) {
    flashElement = document.createElement("div");
    flashElement.className = "sfx-flash";
    flashElement.setAttribute("aria-hidden", "true");
    document.body.append(flashElement);
  }
  flashElement.classList.remove("is-good", "is-bad");
  // Force a style flush so re-adding the class restarts the animation.
  void flashElement.offsetWidth;
  flashElement.classList.add(tone === "good" ? "is-good" : "is-bad");
}

/** Call directly from a gesture so the first map click can make a sound on Safari too. */
export function unlockSound(): void {
  if (!enabled) return;
  const audio = ensureContext();
  if (audio?.state === "suspended") void audio.resume().catch(() => {});
}

export type GeoSoundCue = "pin" | "submit" | "round" | "score" | "finish" | "countdown" | "go";

let noiseBuffer: AudioBuffer | null = null;

/** Filtered air/percussion gives UI actions a physical texture, without audio downloads. */
function air(offset: number, duration: number, from: number, to: number, volume: number): () => void {
  const audio = ensureContext();
  if (!audio || !master || audio.state !== "running") return () => {};
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.5), audio.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const envelope = audio.createGain();
  const start = audio.currentTime + offset;
  source.buffer = noiseBuffer;
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.035, duration * 0.2));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter); filter.connect(envelope); envelope.connect(master);
  const disconnect = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  source.onended = disconnect;
  source.start(start); source.stop(start + duration + 0.02);
  return () => { try { source.stop(); } catch { /* Already finished. */ } disconnect(); };
}

/** Original layered earcons. All voices share mute and are cancellable on navigation. */
export function playGeoSound(cue: GeoSoundCue, score = 0): () => void {
  if (!enabled) return () => {};
  const stops: Array<() => void> = [];
  const note = (frequency: number, offset: number, duration: number, options: ToneOptions = {}) => {
    stops.push(tone(frequency, offset, duration, { gain: 0.55, attack: 0.004, ...options }));
  };
  const texture = (offset: number, duration: number, from: number, to: number, gain: number) => {
    stops.push(air(offset, duration, from, to, gain));
  };
  const chime = (frequency: number, offset: number, duration: number, gain = 0.6) => {
    note(frequency, offset, duration, { type: "sine", gain });
    note(frequency * 2.76, offset, duration * 0.42, { type: "sine", gain: gain * 0.18 });
    note(frequency * 4.2, offset, duration * 0.23, { type: "sine", gain: gain * 0.06 });
  };
  if (cue === "countdown") {
    // A tight clock strike, with a higher final tick before the launch chord.
    const frequency = score === 1 ? 880 : 659.25;
    texture(0, 0.028, 4200, 1700, 0.35);
    note(180, 0, 0.085, { type: "sine", endFrequency: 95, gain: 0.55 });
    chime(frequency, 0, 0.2, 0.8);
  } else if (cue === "go" || cue === "round") {
    texture(0, 0.16, 800, 6000, 0.6);
    note(164.81, 0.015, 0.24, { type: "sine", gain: 0.65 });
    [659.25, 830.61, 987.77].forEach((f, i) => chime(f, 0.02 + i * 0.055, 0.32, 0.46));
    chime(1318.51, 0.19, 0.38, 0.35);
  } else if (cue === "pin") {
    // A little tactile tap underneath a bright compass-like pluck.
    texture(0, 0.045, 3300, 1100, 0.6);
    note(240, 0, 0.12, { type: "sine", endFrequency: 90, gain: 0.9 });
    chime(1108.73, 0.012, 0.23, 0.66);
    chime(1661.22, 0.065, 0.17, 0.12);
  } else if (cue === "submit") {
    texture(0, 0.2, 450, 6200, 0.85);
    note(90, 0.11, 0.2, { type: "sine", endFrequency: 55, gain: 0.95 });
    note(330, 0.015, 0.13, { endFrequency: 660, gain: 0.25 });
    chime(880, 0.14, 0.3, 0.65);
    chime(1318.51, 0.21, 0.22, 0.2);
  } else if (cue === "score") {
    // Light ascending ticks follow the 850ms count-up, then resolve into a score chord.
    [523.25, 587.33, 659.25, 783.99, 880, 987.77].forEach((f, i) => {
      note(f, 0.18 + i * 0.09, 0.075, { gain: 0.25 });
    });
    texture(0.71, 0.12, 1700, 6500, 0.28);
    note(score >= 4500 ? 130.81 : 196, 0.76, 0.35, { type: "sine", gain: 0.7 });
    const chord = score >= 4500 ? [523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25];
    chord.forEach((f, i) => chime(f, 0.76 + i * 0.025, 0.45, 0.38));
    if (score >= 4500) chime(1567.98, 1.04, 0.26, 0.2);
  } else {
    // A compact victory hook with bass, a chord and a final sparkle.
    texture(0, 0.2, 900, 7000, 0.55);
    note(130.81, 0, 0.38, { type: "sine", gain: 0.7 });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => chime(f, i * 0.105, 0.3, 0.62));
    [523.25, 659.25, 783.99].forEach(f => chime(f, 0.62, 0.52, 0.3));
    chime(1567.98, 0.8, 0.38, 0.23);
    chime(2093, 0.93, 0.28, 0.12);
  }
  return () => stops.forEach(stop => stop());
}
