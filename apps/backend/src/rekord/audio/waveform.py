"""Compute a downsampled waveform (peak per bin) for a media file.

Used by the UI to show a thumbnail of the audio plus a progress sweep during
analysis. Cached to disk per-media-asset since it's deterministic and not cheap
on long files.
"""
from __future__ import annotations

import array
import asyncio
import json
import logging
from pathlib import Path

from .ffmpeg import FFmpegError

log = logging.getLogger(__name__)

# Low sample-rate keeps memory bounded for long files: at 8 kHz mono s16le,
# a 90-min mix is ~86 MB streamed (we never hold it all in memory anyway —
# we accumulate per-bin maxima and discard).
_WAVEFORM_RATE = 8000
_BYTES_PER_SAMPLE = 2  # int16 LE mono


async def compute_waveform_peaks(media_path: Path, duration_seconds: float, bins: int) -> list[float]:
    """Return `bins` peak amplitudes (0..1) covering the whole file."""
    if bins <= 0:
        raise ValueError("bins must be positive")
    if duration_seconds <= 0:
        return []

    total_samples = max(bins, int(duration_seconds * _WAVEFORM_RATE))
    samples_per_bin = max(1, total_samples // bins)

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-loglevel", "error",
        "-i", str(media_path),
        "-ac", "1",
        "-ar", str(_WAVEFORM_RATE),
        "-f", "s16le",
        "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    peaks: list[float] = []
    bin_max = 0
    bin_count = 0
    leftover = b""
    assert proc.stdout is not None

    try:
        while True:
            buf = await proc.stdout.read(64 * 1024)
            if not buf:
                break
            data = leftover + buf
            # Trim odd byte for int16 alignment.
            if len(data) % 2:
                leftover = data[-1:]
                data = data[:-1]
            else:
                leftover = b""

            arr = array.array("h")
            arr.frombytes(data)
            for sample in arr:
                v = sample if sample >= 0 else -sample
                if v > bin_max:
                    bin_max = v
                bin_count += 1
                if bin_count >= samples_per_bin:
                    peaks.append(bin_max / 32768.0)
                    bin_max = 0
                    bin_count = 0
                    if len(peaks) >= bins:
                        break
            if len(peaks) >= bins:
                break
    finally:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        await proc.wait()

    if bin_count > 0 and len(peaks) < bins:
        peaks.append(bin_max / 32768.0)

    if proc.returncode and proc.returncode != 0 and not peaks:
        err = (await proc.stderr.read()).decode(errors="ignore") if proc.stderr else ""
        raise FFmpegError(f"ffmpeg waveform decode failed: {err}")

    # Pad to exactly `bins` if rounding left us short (always rare/tiny).
    while len(peaks) < bins:
        peaks.append(0.0)
    return peaks[:bins]


def cache_path_for(cache_dir: Path, media_id: str, bins: int) -> Path:
    return cache_dir / f"{media_id}_{bins}.json"


async def get_or_compute_waveform(
    media_path: Path,
    duration_seconds: float,
    bins: int,
    cache_dir: Path,
    media_id: str,
) -> list[float]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_path_for(cache_dir, media_id, bins)
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except (OSError, ValueError):
            log.warning("waveform cache unreadable, recomputing: %s", cache)

    peaks = await compute_waveform_peaks(media_path, duration_seconds, bins)
    try:
        cache.write_text(json.dumps(peaks))
    except OSError as exc:
        log.warning("could not write waveform cache %s: %s", cache, exc)
    return peaks
