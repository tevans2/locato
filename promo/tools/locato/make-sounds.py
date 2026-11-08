"""Render Locato's game sounds (locato/src/ui/dom/sfx.ts) to WAV files, plus a whoosh and a music bed.

The game synthesizes its sounds with Web Audio; this reproduces the same notes, waveforms and
envelopes offline so the videos sound like the game. Re-run after changing sfx.ts:
    python3 tools/locato/make-sounds.py
"""
import os
import wave

import numpy as np

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SFX = os.path.join(ROOT, "public/locato/sfx")
MUSIC = os.path.join(ROOT, "public/locato/music")


def osc(kind, freq, n):
    t = np.arange(n) / SR
    ph = (freq * t) % 1.0
    if kind == "sine":
        return np.sin(2 * np.pi * ph)
    if kind == "square":
        return np.where(ph < 0.5, 1.0, -1.0)
    if kind == "sawtooth":
        return 2 * ph - 1
    return 4 * np.abs(ph - 0.5) - 1  # triangle


def tone(buf, freq, offset, dur, kind="triangle", gain=1.0):
    """Same envelope as the game: exp ramp to `gain` in 12ms, exp decay to ~0 at `dur`."""
    n = int((dur + 0.05) * SR)
    t = np.arange(n) / SR
    env = np.where(
        t < 0.012,
        0.0001 * (gain / 0.0001) ** (t / 0.012),
        gain * (0.0001 / gain) ** np.clip((t - 0.012) / max(dur - 0.012, 1e-3), 0, 1),
    )
    s = int(offset * SR)
    seg = osc(kind, freq, n) * env
    buf[s : s + n] += seg[: len(buf) - s]


def render(notes, length):
    buf = np.zeros(int(length * SR))
    for args in notes:
        tone(buf, *args)
    return buf


def save(path, x, peak=0.7):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    # tiny fade at both ends against clicks
    f = min(len(x) // 4, int(0.004 * SR))
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print("wrote", os.path.relpath(path, ROOT), f"{len(x) / SR:.2f}s")


# ---- the game's cues (same frequencies/timings as sfx.ts) ---------------------
save(f"{SFX}/correct.wav", render([(523.25, 0, 0.14), (659.25, 0.08, 0.14), (783.99, 0.16, 0.24)], 0.5))
save(f"{SFX}/ping.wav", render([(880, 0, 0.12, "sine", 0.8), (1174.66, 0.09, 0.16, "sine", 0.5)], 0.35), 0.55)
save(f"{SFX}/wrong.wav", render([(196, 0, 0.16, "square", 0.5), (138.59, 0.11, 0.26, "square", 0.45)], 0.45), 0.45)
save(f"{SFX}/time-up.wav", render([(440, 0, 0.14, "sawtooth", 0.5), (329.63, 0.15, 0.14, "sawtooth", 0.5), (220, 0.3, 0.32, "sawtooth", 0.55)], 0.7), 0.45)
save(f"{SFX}/victory.wav", render([(523.25, 0, 0.12), (659.25, 0.09, 0.12), (783.99, 0.18, 0.12), (1046.5, 0.27, 0.34)], 0.7))
save(f"{SFX}/tick.wav", render([(1318.51, 0, 0.05, "sine", 0.35)], 0.1), 0.4)

# ---- soft whoosh for things arriving (filtered noise, rising then falling) ----
rng = np.random.default_rng(7)
n = int(0.45 * SR)
noise = rng.standard_normal(n)
t = np.arange(n) / n
cut = 300 + 2600 * np.sin(np.pi * t) ** 2  # band sweeps up and back down
out = np.zeros(n)
y = 0.0
for i in range(n):  # one-pole low-pass with moving cutoff
    a = 1 - np.exp(-2 * np.pi * cut[i] / SR)
    y += a * (noise[i] - y)
    out[i] = y
out *= np.sin(np.pi * t) ** 1.5
save(f"{SFX}/whoosh.wav", out, 0.35)

# ---- music bed: calm, light, loops seamlessly (Am - F - C - G at 96 bpm) ----------
bpm = 96
beat = 60 / bpm
bars = 8
length = bars * 4 * beat
bed = np.zeros(int(length * SR))
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # midi: Am F C G
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
tt = np.arange(len(bed)) / SR
for b in range(bars):
    ch = chords[b % 4]
    s, e = int(b * 4 * beat * SR), int((b + 1) * 4 * beat * SR)
    seg = tt[s:e] - tt[s]
    dur = seg[-1]
    # pad: soft detuned sines with slow swell
    env = np.minimum(1, seg / 0.8) * np.minimum(1, (dur - seg) / 0.6)
    for m in ch:
        for det in (-0.12, 0.12):
            bed[s:e] += 0.05 * env * np.sin(2 * np.pi * hz(m + 12 + det) * seg)
    # bass on the root
    bed[s:e] += 0.07 * env * np.sin(2 * np.pi * hz(ch[0] - 12) * seg)
    # light plucked arpeggio, eighth notes
    arp = [ch[0] + 24, ch[1] + 24, ch[2] + 24, ch[1] + 24]
    for k in range(8):
        tone(bed, hz(arp[k % 4]), b * 4 * beat + k * beat / 2, 0.35, "triangle", 0.09)
# loop seam: crossfade the tail into the head
xf = int(0.05 * SR)
bed[:xf] = bed[:xf] * np.linspace(0, 1, xf) + bed[-xf:] * np.linspace(1, 0, xf)
bed = bed[:-xf]
save(f"{MUSIC}/bed.wav", bed, 0.6)
