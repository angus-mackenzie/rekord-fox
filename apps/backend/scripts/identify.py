"""CLI: run end-to-end identification against a local audio file.

Usage:
    python scripts/identify.py <audio-file> [--provider shazam|fake_csv]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from rekord.audio.chunker import plan_chunks
from rekord.audio.ffmpeg import extract_chunk, probe_duration
from rekord.config import settings
from rekord.providers import get_provider
from rekord.timeline import ChunkResult, reconstruct_timeline


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--provider", default=settings.provider)
    parser.add_argument("--window", type=float, default=settings.chunk_seconds)
    parser.add_argument("--overlap", type=float, default=settings.chunk_overlap_seconds)
    parser.add_argument("--max-chunks", type=int, default=None,
                        help="cap chunks for quick smoke runs")
    parser.add_argument("--concurrency", type=int, default=settings.provider_concurrency,
                        help="parallel provider requests (Shazam tolerates ~8)")
    args = parser.parse_args()

    if not args.audio.exists():
        print(f"file not found: {args.audio}", file=sys.stderr)
        return 1

    duration = await probe_duration(args.audio)
    windows = plan_chunks(duration, args.window, args.overlap)
    if args.max_chunks:
        windows = windows[: args.max_chunks]

    provider = get_provider(args.provider)
    print(f"provider={provider.name} duration={duration:.1f}s chunks={len(windows)}", file=sys.stderr)

    sem = asyncio.Semaphore(args.concurrency)
    chunk_results: list[ChunkResult] = []

    async def process(w):
        async with sem:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                p = Path(tf.name)
            try:
                await extract_chunk(args.audio, p, w.start_seconds, w.duration, settings.sample_rate)
                cands = await provider.identify_chunk(p, w)
            finally:
                p.unlink(missing_ok=True)
            print(
                f"  [{w.start_seconds:7.1f}s] "
                + (f"{cands[0].title} — {cands[0].artist}" if cands else "(no match)"),
                file=sys.stderr,
                flush=True,
            )
            return ChunkResult(window=w, candidates=cands)

    chunk_results = list(await asyncio.gather(*(process(w) for w in windows)))
    chunk_results.sort(key=lambda r: r.window.start_seconds)

    segments = reconstruct_timeline(chunk_results)
    print(json.dumps(
        [
            {
                "start": round(s.start_seconds, 1),
                "end": round(s.end_seconds, 1),
                "state": s.state.value,
                "confidence": round(s.confidence, 3),
                "title": s.title,
                "artist": s.artist,
                "candidate_count": len(s.candidates),
            }
            for s in segments
        ],
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
