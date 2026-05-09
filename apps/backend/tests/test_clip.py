"""extract_audio_clip is the seam worktree 2 (re-identification) will depend
on. Verify it produces a usable WAV for any (start, end) inside the source.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest

from rekord.audio.clip import extract_audio_clip


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


@pytest.fixture()
def synth_wav(tmp_path: Path) -> Path:
    """Generate a 5-second 440 Hz sine WAV with ffmpeg's lavfi source.

    Self-contained — no external audio asset needed for the test to run.
    """
    if not _ffmpeg_available():
        pytest.skip("ffmpeg not on PATH")
    out = tmp_path / "src.wav"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
            "-ar", "44100", "-ac", "1",
            str(out),
        ],
        check=True,
    )
    return out


def test_extract_audio_clip_produces_correct_duration(synth_wav, tmp_path):
    out = asyncio.run(
        extract_audio_clip(synth_wav, 1.0, 3.0, output_dir=tmp_path)
    )
    try:
        assert out.exists() and out.stat().st_size > 0
        # ffprobe the result so we know the duration matches what we asked for.
        probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(out),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        duration = float(probe.stdout.strip())
        # Allow a small tolerance — `-ss` before `-i` rounds to the nearest
        # frame in the source.
        assert abs(duration - 2.0) < 0.1, f"got {duration:.3f}s"
    finally:
        out.unlink(missing_ok=True)


def test_extract_audio_clip_rejects_invalid_window(synth_wav):
    with pytest.raises(ValueError):
        asyncio.run(extract_audio_clip(synth_wav, 2.0, 2.0))
    with pytest.raises(ValueError):
        asyncio.run(extract_audio_clip(synth_wav, 3.0, 1.0))


def test_extract_audio_clip_raises_when_source_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        asyncio.run(extract_audio_clip(tmp_path / "nope.wav", 0.0, 1.0))
