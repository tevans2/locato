"""Generate many lines with Chatterbox in one model load (called by tools/voice/voice.mjs).

    python chatterbox_batch.py jobs.json
jobs.json: {"exaggeration": 0.9, "cfg": 0.35, "ref": "path/to/voice.wav" | null,
            "jobs": [{"text": "...", "out": "/abs/path.wav", "seed": 1}, ...]}
Writes 16-bit PCM WAVs. Chatterbox: MIT licence (Resemble AI); output carries their inaudible Perth watermark.
"""
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import torch  # noqa: E402
import torchaudio  # noqa: E402
from chatterbox.tts import ChatterboxTTS  # noqa: E402

spec = json.load(open(sys.argv[1]))
dev = os.environ.get("CHATTERBOX_DEVICE", "cpu")  # CPU is steadier than MPS for this model on Apple Silicon
model = ChatterboxTTS.from_pretrained(device=dev)
kw = {"exaggeration": spec["exaggeration"], "cfg_weight": spec["cfg"]}
if spec.get("ref"):
    kw["audio_prompt_path"] = spec["ref"]
for job in spec["jobs"]:
    torch.manual_seed(job.get("seed", 0))
    wav = model.generate(job["text"], **kw)
    torchaudio.save(job["out"], wav.cpu(), model.sr, encoding="PCM_S", bits_per_sample=16)
    print("done", job["out"], flush=True)
