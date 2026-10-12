#!/usr/bin/env python3
"""Synthesize narration clips with Piper TTS (offline neural voices).

Reads a JSON job on stdin:
  {"voice": "en_US-ljspeech-high", "lengthScale": 1.1, "lines": [{"id": "q1", "text": "..."}]}
Writes one WAV per line into the cache and prints, as JSON on stdout:
  {"q1": {"path": ".../<hash>.wav", "durationMs": 2310}}

Clips are cached by voice + speed + text, so re-rendering a video only synthesizes changed lines.
Run with the project venv: .venv/bin/python tools/narrate.py < job.json
"""
import hashlib
import json
import sys
import wave
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VOICE_DIR = REPO_ROOT / ".cache" / "voices"
CLIP_DIR = REPO_ROOT / ".cache" / "narration"


def ensure_voice(name: str) -> Path:
    model = VOICE_DIR / f"{name}.onnx"
    if not model.exists():
        from piper.download_voices import download_voice

        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        print(f"Downloading voice {name} ...", file=sys.stderr)
        download_voice(name, VOICE_DIR)
    return model


def clip_duration_ms(path: Path) -> int:
    with wave.open(str(path), "rb") as wav:
        return round(wav.getnframes() * 1000 / wav.getframerate())


def main() -> int:
    job = json.load(sys.stdin)
    voice_name = job.get("voice") or "en_US-ljspeech-high"
    length_scale = float(job.get("lengthScale") or 1.0)
    CLIP_DIR.mkdir(parents=True, exist_ok=True)

    voice = None
    results = {}
    for line in job.get("lines", []):
        text = str(line["text"]).strip()
        key = hashlib.sha256(f"{voice_name}|{length_scale}|{text}".encode("utf-8")).hexdigest()[:20]
        path = CLIP_DIR / f"{key}.wav"
        if not path.exists():
            if voice is None:
                from piper import PiperVoice, SynthesisConfig

                voice = PiperVoice.load(ensure_voice(voice_name))
                config = SynthesisConfig(length_scale=length_scale)
            partial = path.with_suffix(".tmp")
            with wave.open(str(partial), "wb") as wav:
                voice.synthesize_wav(text, wav, syn_config=config)
            partial.rename(path)
        results[line["id"]] = {"path": str(path), "durationMs": clip_duration_ms(path)}

    json.dump(results, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
