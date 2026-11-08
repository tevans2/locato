#!/usr/bin/env node
// A long-running speech-recognition worker (local Whisper via transformers.js) for checking voice clips.
//   stdin:  {"id": "...", "file": "/abs/path.wav"}      one per line
//   stdout: {"id": "...", "text": "what it heard"}     one per line; {"ready": true} first
// Used by tools/locato/voicebuild.ts.
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const {pipeline} = await import('@huggingface/transformers');
const asr = await pipeline('automatic-speech-recognition', process.argv[2] ?? 'onnx-community/whisper-base.en', {dtype: 'q8'});
const readWav = (file) => {
  const b = readFileSync(file);
  let off = 12, fmt, data;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = {ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22)};
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = fmt.bits === 32 ? data.readFloatLE(i * 4 * fmt.ch) : data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return {x, sr: fmt.sr};
};
console.log(JSON.stringify({ready: true}));
for await (const line of createInterface({input: process.stdin})) {
  if (!line.trim()) continue;
  const {id, file} = JSON.parse(line);
  try {
    const {x, sr} = readWav(file);
    const r = sr / 16000, m = Math.floor(x.length / r), y = new Float32Array(m);
    for (let i = 0; i < m; i++) y[i] = x[Math.floor(i * r)];
    console.log(JSON.stringify({id, text: (await asr(y)).text.trim()}));
  } catch (e) {
    console.log(JSON.stringify({id, text: '', error: String(e).slice(0, 200)}));
  }
}
