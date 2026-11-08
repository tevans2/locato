// Local speech-to-text check (Whisper via transformers.js): node tools/voice/transcribe.mjs a.wav b.wav ...
import {pipeline} from '@huggingface/transformers';
import {readFileSync} from 'node:fs';
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {dtype: 'q8'});
const readWav = (p) => {
  const b = readFileSync(p);
  let off = 12, fmt, data;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = {ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22), tag: b.readUInt16LE(off + 8)};
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = fmt.bits === 32 ? data.readFloatLE(i * 4 * fmt.ch) : data.readInt16LE(i * 2 * fmt.ch) / 32768;
  // resample to 16 kHz (linear) for Whisper
  const r = fmt.sr / 16000, m = Math.floor(n / r), y = new Float32Array(m);
  for (let i = 0; i < m; i++) { const p = i * r, j = Math.floor(p), f = p - j; y[i] = x[j] * (1 - f) + (x[j + 1] ?? x[j]) * f; }
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  return {y, dur: n / fmt.sr, peak};
};
for (const p of process.argv.slice(2)) {
  const {y, dur, peak} = readWav(p);
  const {text} = await asr(y);
  console.log(`${p.split('/').pop().padEnd(16)} ${dur.toFixed(2)}s peak ${peak.toFixed(2)} |${text}`);
}
