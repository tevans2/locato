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
    context = new Ctor();
    master = context.createGain();
    // Keep everything gentle; these are cues, not music.
    master.gain.value = 0.16;
    master.connect(context.destination);
  }
  // Autoplay policies start the context suspended. Browsers lift the gate on the next
  // gesture, so piggyback resume on pointer/key input; resume() is idempotent and the
  // listeners stay bound because tabs can re-suspend after backgrounding.
  if (context.state === "suspended" && !resumeBound) {
    resumeBound = true;
    const resume = (): void => {
      void context?.resume();
    };
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume, { passive: true });
  }
  return context;
}

interface ToneOptions {
  readonly type?: OscillatorType;
  readonly gain?: number;
}

function tone(frequency: number, offsetSeconds: number, durationSeconds: number, options: ToneOptions = {}): void {
  const audio = ensureContext();
  if (!audio || !master || audio.state !== "running") return;
  const start = audio.currentTime + offsetSeconds;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = options.type ?? "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 1, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);
  oscillator.connect(gain);
  gain.connect(master);
  oscillator.start(start);
  oscillator.stop(start + durationSeconds + 0.05);
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
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

/** Toggle button styled to sit beside the global theme switch in the app header. */
export function createSoundToggle(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "global-sound-switch theme-switch";

  const label = document.createElement("span");
  label.className = "theme-switch-label sfx-toggle-label";
  button.append(label);

  const sync = (): void => {
    label.textContent = enabled ? "Sound on" : "Sound off";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Disable sound effects" : "Enable sound effects");
  };

  button.addEventListener("click", () => {
    setSoundEnabled(!enabled);
    sync();
    if (enabled) playCorrect(); // audible confirmation the cue channel is live
  });
  window.addEventListener(SOUND_CHANGE_EVENT, sync);
  sync();
  return button;
}
