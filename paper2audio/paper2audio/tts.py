"""Text-to-speech with two free, unlimited engines.

* Edge (default): Microsoft's neural voices used by the Edge "Read aloud"
  feature. No API key or quota; needs an internet connection.
* Piper (voices named ``piper:<voice>``, e.g. ``piper:en_US-lessac-medium``):
  runs entirely offline on your CPU. The voice model is downloaded once.

Long documents are split at sentence boundaries, synthesized concurrently, and
the segments are joined into a single audio file.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Callable

import edge_tts

DEFAULT_VOICE = "en-US-AndrewMultilingualNeural"
CHUNK_CHARS = 2500
PIPER_PREFIX = "piper:"
PIPER_VOICES = ["en_US-lessac-medium", "en_US-ryan-high", "en_US-amy-medium", "en_GB-alba-medium"]
VOICE_DIR = Path(os.environ.get("P2A_DATA_DIR", Path.home() / ".paper2audio")) / "voices"

ProgressFn = Callable[[int, int], None]


def split_text(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    chunks: list[str] = []
    buf = ""
    for para in text.split("\n\n"):
        sentences = re.split(r"(?<=[.!?])\s+", para.strip())
        for sent in sentences:
            while len(sent) > limit:  # pathological run-on text
                chunks.append(sent[:limit])
                sent = sent[limit:]
            if len(buf) + len(sent) + 1 > limit and buf:
                chunks.append(buf)
                buf = ""
            buf = f"{buf} {sent}".strip()
        buf += "\n"
    if buf.strip():
        chunks.append(buf.strip())
    return [c for c in chunks if c.strip()]


async def list_voices(prefix: str = "") -> list[dict]:
    try:
        voices = sorted(await edge_tts.list_voices(), key=lambda v: v["ShortName"])
    except Exception:  # offline: only Piper voices are usable
        voices = []
    voices += [
        {"ShortName": PIPER_PREFIX + v, "Gender": "offline", "Locale": v.split("-")[0].replace("_", "-")}
        for v in PIPER_VOICES
    ]
    return [v for v in voices if v["ShortName"].startswith(prefix) or v["Locale"].startswith(prefix)]


def _fmt_rate(speed: float) -> str:
    pct = round((speed - 1.0) * 100)
    return f"{pct:+d}%"


async def _synth_chunk(text: str, voice: str, rate: str, retries: int = 4) -> bytes:
    delay = 2.0
    for attempt in range(retries):
        try:
            audio = bytearray()
            async for msg in edge_tts.Communicate(text, voice, rate=rate).stream():
                if msg["type"] == "audio":
                    audio.extend(msg["data"])
            if audio:
                return bytes(audio)
            raise RuntimeError("empty audio")
        except Exception:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


async def synthesize(
    text: str,
    out_path: Path,
    voice: str = DEFAULT_VOICE,
    speed: float = 1.0,
    concurrency: int = 4,
    progress: ProgressFn | None = None,
) -> Path:
    chunks = split_text(text)
    if not chunks:
        raise ValueError("No readable text found")
    if voice.startswith(PIPER_PREFIX):
        return await asyncio.to_thread(
            _synthesize_piper, chunks, out_path, voice[len(PIPER_PREFIX):], speed, progress
        )
    rate = _fmt_rate(speed)
    sem = asyncio.Semaphore(concurrency)
    results: list[bytes | None] = [None] * len(chunks)
    done = 0

    async def worker(i: int, chunk: str) -> None:
        nonlocal done
        async with sem:
            results[i] = await _synth_chunk(chunk, voice, rate)
        done += 1
        if progress:
            progress(done, len(chunks))

    await asyncio.gather(*(worker(i, c) for i, c in enumerate(chunks)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("wb") as f:
        for part in results:
            f.write(part or b"")
    return out_path


def _load_piper(name: str):
    from piper import PiperVoice
    from piper.download_voices import download_voice

    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    model = VOICE_DIR / f"{name}.onnx"
    if not model.exists():
        download_voice(name, VOICE_DIR)
    return PiperVoice.load(model)


def _synthesize_piper(
    chunks: list[str], out_path: Path, name: str, speed: float, progress: ProgressFn | None
) -> Path:
    from piper import SynthesisConfig

    voice = _load_piper(name)
    cfg = SynthesisConfig(length_scale=1.0 / speed)
    wav_path = out_path.with_suffix(".wav")
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_path), "wb") as wav:
        for i, chunk in enumerate(chunks):
            voice.synthesize_wav(chunk, wav, syn_config=cfg, set_wav_format=(i == 0))
            if progress:
                progress(i + 1, len(chunks))

    if out_path.suffix.lower() == ".wav":
        return wav_path
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return wav_path  # no encoder available; WAV plays everywhere
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav_path), "-b:a", "64k", str(out_path)],
        check=True,
    )
    wav_path.unlink()
    return out_path
