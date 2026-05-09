"""Extract a precise [start, end] sub-clip of a media file as decoded mono WAV.

This is the seam future identification work depends on: given a manual-tag
record (media + start_seconds + end_seconds), produce an audio file ready to
fingerprint. Stays in the audio module — no DB or HTTP coupling — so a
LocalLibraryProvider can import it directly.
"""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

from .ffmpeg import FFmpegError


async def extract_audio_clip(
    media_path: Path,
    start_seconds: float,
    end_seconds: float,
    *,
    sample_rate: int = 16000,
    channels: int = 1,
    output_dir: Path | None = None,
) -> Path:
    """Decode media[start:end] to a mono WAV at the given sample rate.

    Returns the path to a tempfile the caller is responsible for deleting.
    Defaults match the chunk extraction used in the worker (16 kHz mono),
    so callers can swap between live-chunk fingerprinting and
    user-tag fingerprinting without re-tuning the audio.
    """
    if end_seconds <= start_seconds:
        raise ValueError("end_seconds must be > start_seconds")
    if not media_path.exists():
        raise FileNotFoundError(media_path)

    duration = end_seconds - start_seconds
    out = tempfile.NamedTemporaryFile(
        suffix=".wav", delete=False, dir=str(output_dir) if output_dir else None
    )
    out.close()
    out_path = Path(out.name)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        # -ss before -i is fast (input seek) but slightly less accurate.
        # We follow with -t to bound duration; the worker chunker uses the
        # same pattern, so accuracy is consistent across the system.
        "-ss", f"{start_seconds}",
        "-t", f"{duration}",
        "-i", str(media_path),
        "-ac", f"{channels}",
        "-ar", f"{sample_rate}",
        "-vn",
        str(out_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        out_path.unlink(missing_ok=True)
        raise FFmpegError(f"ffmpeg clip extract failed: {err.decode(errors='ignore')}")
    return out_path
