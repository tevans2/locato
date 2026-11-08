"""A long-running Chatterbox worker: loads the model once, then generates one line per JSON request on stdin.

    python chatterbox_worker.py '{"device": "mps", "exaggeration": 1.3, "cfg": 0.3, "ref": "refs/bm_george.wav", "threads": 6}'
stdin:  {"id": "...", "text": "...", "out": "/abs/path.wav", "seed": 7}      one per line
stdout: {"id": "...", "ok": true, "secs": 5.2}  (or "ok": false, "error": "...")   one per line; "ready" first
Used by tools/locato/voicebuild.ts. Chatterbox: MIT licence (Resemble AI); output carries their inaudible Perth watermark.
"""
import gc
import json
import sys
import time
import warnings

warnings.filterwarnings("ignore")
import torch  # noqa: E402
import torchaudio  # noqa: E402
from chatterbox.tts import ChatterboxTTS  # noqa: E402

cfg = json.loads(sys.argv[1])
if cfg.get("threads"):
    torch.set_num_threads(int(cfg["threads"]))
model = ChatterboxTTS.from_pretrained(device=cfg.get("device", "cpu"))
kw = {"exaggeration": cfg["exaggeration"], "cfg_weight": cfg["cfg"]}
# Prepare the voice once. Passing audio_prompt_path to every generate() re-processes the reference each time, and on
# MPS that memory piles up (the worker grew to 16 GB after ~400 lines).
if cfg.get("ref"):
    model.prepare_conditionals(cfg["ref"], exaggeration=cfg["exaggeration"])
print(json.dumps({"ready": True, "device": cfg.get("device", "cpu")}), flush=True)
for raw in sys.stdin:
    if not raw.strip():
        continue
    job = json.loads(raw)
    t = time.time()
    try:
        torch.manual_seed(int(job.get("seed", 0)))
        wav = model.generate(job["text"], **kw)
        if cfg.get("device") == "mps":
            torch.mps.synchronize()
        torchaudio.save(job["out"], wav.cpu(), model.sr, encoding="PCM_S", bits_per_sample=16)
        del wav
        print(json.dumps({"id": job["id"], "ok": True, "secs": round(time.time() - t, 2)}), flush=True)
    except Exception as e:  # keep the worker alive; the build retries or reports the line
        print(json.dumps({"id": job["id"], "ok": False, "error": str(e)[:300]}), flush=True)
    # MPS keeps cached GPU memory between generations and it grows without bound (16 GB after ~400 lines): release it
    gc.collect()
    if cfg.get("device") == "mps":
        torch.mps.empty_cache()
