from __future__ import annotations

import asyncio
import logging
import tempfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from sqlmodel import select

from ..audio.chunker import ChunkWindow, plan_chunks
from ..audio.ffmpeg import extract_chunk
from ..config import settings
from ..db import session_scope
from ..models import (
    AnalysisJob,
    ChunkAttempt,
    JobStatus,
    MediaAsset,
    TimelineSegment,
    TrackCandidate,
)
from ..providers import get_provider
from ..providers.base import NormalizedCandidate, Provider
from ..timeline import ChunkResult, reconstruct_timeline

log = logging.getLogger(__name__)


# In-memory pause registry. The API endpoint sets the event for a job; the
# worker checks it before/inside each chunk and exits cleanly if set.
# Doesn't survive process restarts — recovery on startup handles that case
# by marking running jobs as `paused` so the user can resume them.
_pause_events: dict[str, asyncio.Event] = {}


def request_pause(job_id: str) -> bool:
    """Signal the worker to pause `job_id` at the next safe point.

    Returns True if a worker was running for this job (the signal was set);
    False if there was no in-flight worker (caller should still update the
    DB row to `paused`).
    """
    ev = _pause_events.get(job_id)
    if ev is None:
        return False
    ev.set()
    return True


async def run_analysis(job_id: str, *, resume: bool = False) -> None:
    """Top-level worker entrypoint. Runs in the API event loop as a background task."""
    pause_event = asyncio.Event()
    _pause_events[job_id] = pause_event
    try:
        await _run_analysis_inner(job_id, pause_event, resume=resume)
    except Exception as exc:  # noqa: BLE001
        log.exception("job %s failed", job_id)
        with session_scope() as s:
            job = s.get(AnalysisJob, job_id)
            if job is not None:
                job.status = JobStatus.failed
                job.error_code = exc.__class__.__name__
                job.error_message = str(exc)
                job.finished_at = datetime.now(UTC)
                s.add(job)
                s.commit()
    finally:
        _pause_events.pop(job_id, None)


async def _run_analysis_inner(
    job_id: str, pause_event: asyncio.Event, *, resume: bool
) -> None:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise ValueError(f"job {job_id} not found")
        media = s.get(MediaAsset, job.media_asset_id)
        if media is None:
            raise ValueError(f"media {job.media_asset_id} not found")
        job.status = JobStatus.running
        if not resume:
            job.started_at = datetime.now(UTC)
            job.progress = 0.0
            job.error_code = None
            job.error_message = None
        s.add(job)
        s.commit()
        media_path = Path(media.storage_path)
        duration = media.duration_seconds or 0.0

    if duration <= 0:
        raise ValueError(f"media {media_path} has unknown duration")

    if not resume:
        # Fresh run: clear all prior state so we don't merge with stale rows.
        _wipe_outputs(job_id)
        _wipe_attempts(job_id)

    windows = plan_chunks(duration, settings.chunk_seconds, settings.chunk_overlap_seconds)
    if not windows:
        _persist_segments(job_id, [])
        _mark_succeeded(job_id)
        return

    attempted = _load_attempted_starts(job_id) if resume else set()
    remaining = [w for w in windows if w.start_seconds not in attempted]
    already_done = len(windows) - len(remaining)
    if remaining:
        provider = get_provider()
        log.info(
            "job %s: %d/%d chunks remaining (resume=%s, provider=%s)",
            job_id, len(remaining), len(windows), resume, provider.name,
        )
        await _identify_chunks(
            provider, media_path, remaining, job_id, pause_event,
            total=len(windows), already_done=already_done,
        )

    if pause_event.is_set():
        _mark_paused(job_id)
        return

    # Finalize: rebuild the timeline from ALL persisted candidates so paused-
    # then-resumed runs produce the same output as a single uninterrupted run.
    chunk_results = _load_chunk_results(job_id)
    segments = reconstruct_timeline(chunk_results)
    _persist_segments(job_id, segments)
    _mark_succeeded(job_id)


async def _identify_chunks(
    provider: Provider,
    media_path: Path,
    windows: list[ChunkWindow],
    job_id: str,
    pause_event: asyncio.Event,
    *,
    total: int,
    already_done: int,
) -> None:
    sem = asyncio.Semaphore(settings.provider_concurrency)
    completed = already_done

    async def process(window: ChunkWindow) -> None:
        nonlocal completed
        # Check before paying for the semaphore so we exit fast.
        if pause_event.is_set():
            return
        async with sem:
            if pause_event.is_set():
                return
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                chunk_path = Path(tf.name)
            try:
                await extract_chunk(
                    media_path,
                    chunk_path,
                    window.start_seconds,
                    window.duration,
                    settings.sample_rate,
                )
                candidates = await provider.identify_chunk(chunk_path, window)
            finally:
                chunk_path.unlink(missing_ok=True)
        # Persist candidates + the attempt marker as a unit so a crash between
        # them can't lose data — both are individually idempotent (candidates
        # accumulate, attempts are de-dup'd by start_seconds on read).
        _persist_chunk_candidates(job_id, window, candidates)
        _record_attempt(job_id, window)
        completed += 1
        _update_progress(job_id, completed / total)

    await asyncio.gather(*(process(w) for w in windows))


def _update_progress(job_id: str, fraction: float) -> None:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            return
        job.progress = max(0.0, min(1.0, fraction))
        s.add(job)
        s.commit()


def _wipe_outputs(job_id: str) -> None:
    """Delete any prior candidates/segments for this job so a re-run starts clean."""
    with session_scope() as s:
        for cand in s.exec(
            select(TrackCandidate).where(TrackCandidate.analysis_job_id == job_id)
        ).all():
            s.delete(cand)
        for seg in s.exec(
            select(TimelineSegment).where(TimelineSegment.analysis_job_id == job_id)
        ).all():
            s.delete(seg)
        s.commit()


def _wipe_attempts(job_id: str) -> None:
    with session_scope() as s:
        for a in s.exec(
            select(ChunkAttempt).where(ChunkAttempt.analysis_job_id == job_id)
        ).all():
            s.delete(a)
        s.commit()


def _record_attempt(job_id: str, window: ChunkWindow) -> None:
    with session_scope() as s:
        s.add(
            ChunkAttempt(
                analysis_job_id=job_id,
                start_seconds=window.start_seconds,
                end_seconds=window.end_seconds,
            )
        )
        s.commit()


def _load_attempted_starts(job_id: str) -> set[float]:
    with session_scope() as s:
        rows = s.exec(
            select(ChunkAttempt.start_seconds).where(
                ChunkAttempt.analysis_job_id == job_id
            )
        ).all()
        return {float(r) for r in rows}


def _load_chunk_results(job_id: str) -> list[ChunkResult]:
    """Reconstruct the per-chunk result list from persisted candidates +
    attempts. Empty-result attempts (no candidates) appear as windows with
    empty candidate lists so the timeline engine sees full coverage.
    """
    with session_scope() as s:
        attempts = s.exec(
            select(ChunkAttempt).where(ChunkAttempt.analysis_job_id == job_id)
        ).all()
        cands = s.exec(
            select(TrackCandidate).where(TrackCandidate.analysis_job_id == job_id)
        ).all()

    by_window: dict[tuple[float, float], list[NormalizedCandidate]] = defaultdict(list)
    for c in cands:
        by_window[(c.chunk_start_seconds, c.chunk_end_seconds)].append(
            NormalizedCandidate(
                provider=c.provider,
                title=c.title,
                artist=c.artist,
                confidence=c.confidence,
                provider_track_id=c.provider_track_id,
                album=c.album,
                artwork_url=c.artwork_url,
                external_urls=dict(c.external_urls or {}),
                metadata=dict(c.candidate_metadata or {}),
            )
        )
    # Ensure attempted-but-empty windows show up too.
    for a in attempts:
        by_window.setdefault((a.start_seconds, a.end_seconds), [])

    chunk_results: list[ChunkResult] = []
    for i, ((start, end), cand_list) in enumerate(sorted(by_window.items())):
        chunk_results.append(
            ChunkResult(
                window=ChunkWindow(index=i, start_seconds=start, end_seconds=end),
                candidates=cand_list,
            )
        )
    return chunk_results


def _persist_chunk_candidates(
    job_id: str, window: ChunkWindow, candidates: list[NormalizedCandidate]
) -> None:
    if not candidates:
        return
    with session_scope() as s:
        for c in candidates:
            s.add(
                TrackCandidate(
                    analysis_job_id=job_id,
                    provider=c.provider,
                    chunk_start_seconds=window.start_seconds,
                    chunk_end_seconds=window.end_seconds,
                    title=c.title,
                    artist=c.artist,
                    confidence=c.confidence,
                    provider_track_id=c.provider_track_id,
                    album=c.album,
                    artwork_url=c.artwork_url,
                    external_urls=dict(c.external_urls),
                    candidate_metadata=_safe_metadata(c.metadata),
                )
            )
        s.commit()


def _persist_segments(job_id: str, segments: list) -> None:
    """Replace this job's segments wholesale (called once at end of run)."""
    with session_scope() as s:
        for seg in s.exec(
            select(TimelineSegment).where(TimelineSegment.analysis_job_id == job_id)
        ).all():
            s.delete(seg)
        for seg in segments:
            s.add(
                TimelineSegment(
                    analysis_job_id=job_id,
                    start_seconds=seg.start_seconds,
                    end_seconds=seg.end_seconds,
                    state=seg.state,
                    confidence=seg.confidence,
                    title=seg.title,
                    artist=seg.artist,
                    candidates=seg.candidates,
                    notes=seg.notes,
                )
            )
        s.commit()


def _safe_metadata(meta: dict) -> dict:
    """Drop non-JSON-serializable bits from provider metadata before persisting."""
    import json

    try:
        json.dumps(meta)
        return meta
    except (TypeError, ValueError):
        return {"_note": "metadata not JSON-serializable, dropped"}


def _mark_succeeded(job_id: str) -> None:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            return
        job.status = JobStatus.succeeded
        job.progress = 1.0
        job.finished_at = datetime.now(UTC)
        s.add(job)
        s.commit()


def _mark_paused(job_id: str) -> None:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            return
        job.status = JobStatus.paused
        # Keep progress as-is so the UI bar reflects how far we got.
        s.add(job)
        s.commit()


# Convenience for tests / local runs: take a NormalizedCandidate list directly,
# bypassing FFmpeg + provider, and just produce a timeline + persistence.
async def run_with_synthetic_chunks(
    job_id: str, chunk_results: list[ChunkResult]
) -> list:
    _wipe_outputs(job_id)
    _wipe_attempts(job_id)
    for cr in chunk_results:
        _persist_chunk_candidates(job_id, cr.window, cr.candidates)
        _record_attempt(job_id, cr.window)
    segments = reconstruct_timeline(chunk_results)
    _persist_segments(job_id, segments)
    _mark_succeeded(job_id)
    return segments


# Re-export NormalizedCandidate for convenience
__all__ = ["run_analysis", "run_with_synthetic_chunks", "request_pause", "NormalizedCandidate"]
