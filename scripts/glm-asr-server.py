#!/usr/bin/env python3
"""
glm-asr-server.py
─────────────────────────────────────────────────────────────────────────────
Local FastAPI transcription server for GLM-ASR-Nano (mlx-audio).

Key fix: mlx-audio's internal load_audio() silently returns None for ffmpeg
WAV files, causing "NoneType has no attribute ndim". We bypass it by loading
audio ourselves with soundfile, then calling model.generate(numpy_array)
directly — the model handles numpy arrays without any internal file loading.

Setup:
    pip install mlx-audio fastapi uvicorn soundfile numpy

Run (from the conference-assistant/ directory):
    python scripts/glm-asr-server.py
─────────────────────────────────────────────────────────────────────────────
"""

import os
import sys
import tempfile
import time
import traceback

MODEL_ID  = os.environ.get("GLM_ASR_MODEL", "mlx-community/GLM-ASR-Nano-2512-4bit")
PORT      = int(os.environ.get("GLM_ASR_PORT", "8765"))
HOST      = os.environ.get("GLM_ASR_HOST", "127.0.0.1")

# ── Dependency checks ─────────────────────────────────────────────────────────

def require(import_name, install_cmd):
    try:
        return __import__(import_name)
    except ImportError:
        print(f"\n[glm-asr-server] '{import_name}' not installed.\n  Run: {install_cmd}\n",
              file=sys.stderr)
        sys.exit(1)

require("fastapi",   "pip install fastapi uvicorn")
require("uvicorn",   "pip install fastapi uvicorn")
require("soundfile", "pip install soundfile")
require("numpy",     "pip install numpy")

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn
import soundfile as sf
import numpy as np

try:
    from mlx_audio.stt.utils import load_model
except ImportError:
    print("\n[glm-asr-server] mlx-audio not installed.\n  Run: pip install mlx-audio\n",
          file=sys.stderr)
    sys.exit(1)

# ── Load model ────────────────────────────────────────────────────────────────

print(f"[glm-asr-server] Loading {MODEL_ID} …", flush=True)
print("[glm-asr-server] First run downloads ~300 MB. Please wait.", flush=True)

t0    = time.time()
model = load_model(MODEL_ID)

# model.sample_rate is what GLM-ASR expects (typically 16000)
TARGET_SR = getattr(model, "sample_rate", 16000)
print(f"[glm-asr-server] Model ready in {time.time()-t0:.1f}s  |  target SR: {TARGET_SR} Hz",
      flush=True)
print(f"[glm-asr-server] Listening on http://{HOST}:{PORT}", flush=True)

# ── Audio loading ─────────────────────────────────────────────────────────────

def load_wav_as_numpy(path: str) -> np.ndarray:
    """
    Load a WAV file → float32 mono numpy array at TARGET_SR.
    Uses soundfile (reliable) instead of mlx_audio.load_audio (returns None
    for ffmpeg-produced WAVs).
    """
    audio, sr = sf.read(path, dtype="float32", always_2d=False)

    if audio is None or len(audio) == 0:
        raise ValueError("Audio file is empty or unreadable")

    # Stereo → mono
    if audio.ndim == 2:
        audio = audio.mean(axis=1)

    # Resample if necessary
    if sr != TARGET_SR:
        ratio   = TARGET_SR / sr
        new_len = int(len(audio) * ratio)
        audio   = np.interp(
            np.linspace(0, len(audio) - 1, new_len),
            np.arange(len(audio)),
            audio,
        ).astype(np.float32)

    return audio

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="GLM-ASR local server")

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "sample_rate": TARGET_SR}

@app.post("/transcribe")
async def transcribe(request: Request):
    audio_bytes = await request.body()
    if not audio_bytes:
        return JSONResponse({"error": "empty body"}, status_code=400)

    tmp_path = None
    try:
        # 1. Save incoming WAV bytes to temp file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        # 2. Load with soundfile → float32 mono numpy array
        try:
            audio_np = load_wav_as_numpy(tmp_path)
        except Exception as e:
            return JSONResponse({"error": f"Audio load failed: {e}"}, status_code=422)

        # 3. Call model.generate() with the numpy array directly.
        #    This skips the broken load_audio() code path entirely.
        t_start = time.time()
        result  = model.generate(audio_np)
        elapsed = round((time.time() - t_start) * 1000)

        # 4. Extract text from STTOutput
        if result is None:
            return {"text": "", "language": "auto", "latency_ms": elapsed}

        text = getattr(result, "text", None) or str(result)
        text = text.strip()

        # GLM-ASR doesn't expose per-segment language yet; default to auto
        language = "auto"

        print(f"[glm-asr-server] {elapsed}ms | {text[:80]!r}", flush=True)
        return {"text": text, "language": language, "latency_ms": elapsed}

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[glm-asr-server] ERROR:\n{tb}", file=sys.stderr, flush=True)
        return JSONResponse({"error": str(e), "traceback": tb}, status_code=500)

    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
