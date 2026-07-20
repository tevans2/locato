import { readSettings } from "../../storage/settings";

export type GameFeedbackKind = "correct" | "wrong" | "complete";

function vibrationPattern(kind: GameFeedbackKind): number | number[] {
  if (kind === "complete") return [25, 35, 45];
  return kind === "correct" ? 18 : [22, 28, 22];
}

function tone(kind: GameFeedbackKind): { readonly frequencies: readonly number[]; readonly duration: number } {
  if (kind === "complete") return { frequencies: [523.25, 659.25, 783.99], duration: 0.12 };
  if (kind === "correct") return { frequencies: [659.25, 783.99], duration: 0.08 };
  return { frequencies: [196, 164.81], duration: 0.1 };
}

function playTone(kind: GameFeedbackKind): void {
  const AudioContextType = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextType) return;

  const context = new AudioContextType();
  const sequence = tone(kind);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + sequence.duration * sequence.frequencies.length);
  gain.connect(context.destination);

  sequence.frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = kind === "wrong" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    const start = context.currentTime + index * sequence.duration;
    oscillator.start(start);
    oscillator.stop(start + sequence.duration);
  });

  window.setTimeout(() => void context.close(), sequence.duration * sequence.frequencies.length * 1000 + 80);
}

export function playGameFeedback(storage: Storage, kind: GameFeedbackKind): void {
  const settings = readSettings(storage);
  if (settings.soundEnabled) playTone(kind);
  if (settings.hapticsEnabled && "vibrate" in navigator) navigator.vibrate(vibrationPattern(kind));
}
