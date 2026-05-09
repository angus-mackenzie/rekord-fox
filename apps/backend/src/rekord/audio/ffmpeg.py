from __future__ import annotations

import asyncio
import json
from pathlib import Path


class FFmpegError(RuntimeError):
    pass


async def probe_duration(path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise FFmpegError(f"ffprobe failed: {err.decode(errors='ignore')}")
    data = json.loads(out)
    return float(data["format"]["duration"])


async def extract_chunk(
    src: Path, dst: Path, start: float, duration: float, sample_rate: int
) -> None:
    """Decode a window of audio to mono WAV at given sample rate.

    Preprocessing: mono, resampled. Loudness/silence/denoise are deferred — Shazam's
    fingerprint is robust to those, and adding them would only matter once we add
    fingerprint-matching providers that need clean signal.
    """
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-ss",
        f"{start}",
        "-t",
        f"{duration}",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        f"{sample_rate}",
        "-vn",
        str(dst),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise FFmpegError(f"ffmpeg chunk extract failed: {err.decode(errors='ignore')}")


def file_checksum(path: Path, chunk: int = 1 << 20) -> str:
    import hashlib

    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()
