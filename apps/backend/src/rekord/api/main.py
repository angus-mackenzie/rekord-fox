from __future__ import annotations

import asyncio
import logging
import mimetypes
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from sqlmodel import select

from ..audio.ffmpeg import file_checksum, probe_duration
from ..audio.waveform import get_or_compute_waveform
from ..config import settings
from ..db import init_db, session_scope
from ..models import (
    AnalysisJob,
    ChunkAttempt,
    JobStatus,
    ManualCorrection,
    MediaAsset,
    TimelineSegment,
    TrackCandidate,
)
from ..worker.pipeline import request_pause, run_analysis
from .schemas import (
    JobOut,
    ManualTagCreate,
    ManualTagOut,
    MediaOut,
    SegmentOut,
    TimelineOut,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _recover_orphaned_jobs()
    yield


def _recover_orphaned_jobs() -> None:
    """Mark previously-running jobs as paused so progress isn't lost.

    The worker runs as an asyncio task on the API event loop, so a uvicorn
    restart kills any in-flight analysis with no chance to clean up. We mark
    them `paused` (rather than `failed`) because chunk attempts are persisted
    incrementally — the user can resume and we'll skip the chunks that were
    already done.
    """
    with session_scope() as s:
        stale = s.exec(
            select(AnalysisJob).where(
                AnalysisJob.status.in_([JobStatus.queued, JobStatus.running])  # type: ignore[attr-defined]
            )
        ).all()
        if not stale:
            return
        for job in stale:
            job.status = JobStatus.paused
            job.error_code = "interrupted"
            job.error_message = (
                "Interrupted by a server restart. Resume to continue from where it stopped."
            )
            s.add(job)
        s.commit()
        logging.getLogger(__name__).info(
            "marked %d orphaned job(s) as paused on startup", len(stale)
        )


app = FastAPI(title="Rekord-Fox API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".mp4"}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "provider": settings.provider}


@app.post("/media", response_model=MediaOut)
async def upload_media(file: UploadFile) -> MediaOut:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTS:
        raise HTTPException(415, f"unsupported file type {suffix!r}")

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.upload_dir / f"{Path(file.filename).stem}_{_short_uuid()}{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    duration = await probe_duration(dest)
    checksum = file_checksum(dest)
    content_type = file.content_type or mimetypes.guess_type(str(dest))[0] or "application/octet-stream"

    with session_scope() as s:
        media = MediaAsset(
            original_filename=file.filename or dest.name,
            content_type=content_type,
            # Resolve to an absolute path so the row stays valid no matter
            # which working directory uvicorn runs from later. Storing the
            # raw `dest` (relative to settings.upload_dir at upload time)
            # made existing rows 410 once the cwd changed.
            storage_path=str(dest.resolve()),
            checksum=checksum,
            duration_seconds=duration,
        )
        s.add(media)
        s.commit()
        s.refresh(media)
        return MediaOut.model_validate(media, from_attributes=True)


@app.post("/jobs", response_model=JobOut)
async def create_job(payload: dict, background: BackgroundTasks) -> JobOut:
    media_id = payload.get("media_asset_id")
    if not media_id:
        raise HTTPException(400, "media_asset_id is required")

    with session_scope() as s:
        media = s.get(MediaAsset, media_id)
        if media is None:
            raise HTTPException(404, "media not found")
        job = AnalysisJob(media_asset_id=media.id, status=JobStatus.queued)
        s.add(job)
        s.commit()
        s.refresh(job)
        out = JobOut.model_validate(job, from_attributes=True)

    # Run on the API's event loop. For multi-worker scaling, replace with a
    # task queue (RQ/Celery) — the contract here is "create job, return id".
    asyncio.create_task(run_analysis(out.id))
    return out


@app.get("/jobs", response_model=list[dict])
async def list_jobs(limit: int = 20) -> list[dict]:
    """Recent jobs for the UI's history panel. Joined with media filename so
    the UI doesn't need a second round-trip per row.
    """
    limit = max(1, min(100, limit))
    with session_scope() as s:
        rows = s.exec(
            select(AnalysisJob, MediaAsset)
            .join(MediaAsset, MediaAsset.id == AnalysisJob.media_asset_id)
            .order_by(AnalysisJob.created_at.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": job.id,
                "media_asset_id": job.media_asset_id,
                "status": job.status,
                "progress": job.progress,
                "created_at": job.created_at,
                "finished_at": job.finished_at,
                "media_filename": media.original_filename,
                "duration_seconds": media.duration_seconds,
            }
            for job, media in rows
        ]


@app.get("/media/{media_id}/audio")
async def get_media_audio(media_id: str, request: Request):
    """Stream the raw uploaded audio with HTTP Range support.

    Range matters for the browser <audio> element to seek (and for some
    formats to even start playback efficiently). Without it, scrubbing in
    the player downloads from byte 0 every time.
    """
    with session_scope() as s:
        media = s.get(MediaAsset, media_id)
        if media is None:
            raise HTTPException(404, "media not found")
        path = Path(media.storage_path)
        content_type = media.content_type or "application/octet-stream"
    if not path.exists():
        raise HTTPException(410, "underlying media file is gone")

    return _serve_with_range(path, content_type, request)


def _serve_with_range(path: Path, content_type: str, request: Request) -> Response:
    """Tiny single-range HTTP/1.1 Range responder.

    Handles `Range: bytes=start-end` (open-ended end allowed). Falls back to
    a normal FileResponse when no Range header is present. Multi-range
    requests are not supported (the browser <audio> element never sends them).
    """
    file_size = path.stat().st_size
    range_header = request.headers.get("range") or request.headers.get("Range")
    if not range_header or not range_header.startswith("bytes="):
        # Set Accept-Ranges so browsers know seek is possible on the next request.
        return FileResponse(
            path, media_type=content_type, headers={"Accept-Ranges": "bytes"}
        )

    try:
        spec = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
        start_s, _, end_s = spec.partition("-")
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else file_size - 1
    except ValueError as exc:
        raise HTTPException(400, f"bad Range header: {exc}") from exc
    if start < 0 or end >= file_size or start > end:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    chunk_bytes = end - start + 1

    def iter_file():
        with path.open("rb") as f:
            f.seek(start)
            remaining = chunk_bytes
            while remaining > 0:
                buf = f.read(min(64 * 1024, remaining))
                if not buf:
                    break
                remaining -= len(buf)
                yield buf

    return StreamingResponse(
        iter_file(),
        status_code=206,
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(chunk_bytes),
        },
    )


@app.get("/media/{media_id}/waveform")
async def get_waveform(media_id: str, bins: int = 800) -> dict:
    bins = max(64, min(2000, bins))
    with session_scope() as s:
        media = s.get(MediaAsset, media_id)
        if media is None:
            raise HTTPException(404, "media not found")
        media_path = Path(media.storage_path)
        duration = float(media.duration_seconds or 0.0)
    if duration <= 0:
        raise HTTPException(400, "media duration unknown")
    peaks = await get_or_compute_waveform(
        media_path=media_path,
        duration_seconds=duration,
        bins=bins,
        cache_dir=settings.waveform_cache_dir,
        media_id=media_id,
    )
    return {"peaks": peaks, "duration_seconds": duration, "bins": len(peaks)}


@app.get("/jobs/{job_id}/candidates")
async def get_job_candidates(job_id: str) -> list[dict]:
    """Per-chunk candidates persisted so far. Used by the UI during the
    analysis phase to show tracks rolling in alongside the waveform sweep.
    """
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        rows = s.exec(
            select(TrackCandidate)
            .where(TrackCandidate.analysis_job_id == job_id)
            .order_by(TrackCandidate.chunk_start_seconds, TrackCandidate.id)
        ).all()
        return [
            {
                "id": c.id,
                "provider": c.provider,
                "chunk_start_seconds": c.chunk_start_seconds,
                "chunk_end_seconds": c.chunk_end_seconds,
                "title": c.title,
                "artist": c.artist,
                "confidence": c.confidence,
                "album": c.album,
                "artwork_url": c.artwork_url,
                "external_urls": c.external_urls,
                "provider_track_id": c.provider_track_id,
            }
            for c in rows
        ]


@app.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str) -> None:
    """Delete a job and its candidates + segments + attempts + manual tags.
    Media file is left in place in case other jobs reference it.

    Uses bulk SQL deletes (not session.delete) so the dependent rows go
    before the parent row in a single, ordered transaction — SQLModel's ORM
    delete reorders by its own dependency graph and trips the FK constraint
    when a relationship isn't declared back-populating.
    """
    from sqlalchemy import delete as sql_delete

    with session_scope() as s:
        if s.get(AnalysisJob, job_id) is None:
            raise HTTPException(404, "job not found")
        for model in (TrackCandidate, TimelineSegment, ChunkAttempt, ManualCorrection):
            s.exec(sql_delete(model).where(model.analysis_job_id == job_id))
        s.exec(sql_delete(AnalysisJob).where(AnalysisJob.id == job_id))
        s.commit()


@app.post("/jobs/{job_id}/rebuild-timeline", response_model=JobOut)
async def rebuild_timeline(job_id: str) -> JobOut:
    """Re-fuse this job's persisted candidates with the current timeline engine.

    Used when the fusion algorithm has changed (e.g. the cluster-based update)
    and a previously-analysed mix should reflect the new logic without paying
    for re-analysis. Only segments are replaced — candidates and the job row
    itself are untouched.
    """
    from collections import defaultdict

    from ..audio.chunker import ChunkWindow
    from ..providers.base import NormalizedCandidate
    from ..timeline import ChunkResult, reconstruct_timeline
    from ..worker.pipeline import _persist_segments

    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        rows = s.exec(
            select(TrackCandidate)
            .where(TrackCandidate.analysis_job_id == job_id)
            .order_by(TrackCandidate.chunk_start_seconds, TrackCandidate.id)
        ).all()
        if not rows:
            raise HTTPException(409, "job has no candidates to rebuild from")

        # Group candidate rows back into per-chunk buckets keyed by (start, end).
        by_window: dict[tuple[float, float], list[NormalizedCandidate]] = defaultdict(list)
        for r in rows:
            by_window[(r.chunk_start_seconds, r.chunk_end_seconds)].append(
                NormalizedCandidate(
                    provider=r.provider,
                    title=r.title,
                    artist=r.artist,
                    confidence=r.confidence,
                    provider_track_id=r.provider_track_id,
                    album=r.album,
                    artwork_url=r.artwork_url,
                    external_urls=dict(r.external_urls or {}),
                    metadata=dict(r.candidate_metadata or {}),
                )
            )

    chunk_results = [
        ChunkResult(
            window=ChunkWindow(index=i, start_seconds=start, end_seconds=end),
            candidates=cands,
        )
        for i, ((start, end), cands) in enumerate(sorted(by_window.items()))
    ]
    segments = reconstruct_timeline(chunk_results)
    _persist_segments(job_id, segments)

    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        return JobOut.model_validate(job, from_attributes=True)


@app.post("/jobs/{job_id}/pause", response_model=JobOut)
async def pause_job(job_id: str) -> JobOut:
    """Signal the worker to pause and return immediately.

    Status will not be `paused` in the response — that flip happens later when
    the worker observes the signal (next chunk boundary). On a long mix with
    high concurrency this can take ~10s for in-flight chunks to drain. The
    frontend should show a `pausing` indicator and poll until status flips.
    """
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        if job.status not in (JobStatus.running, JobStatus.queued):
            raise HTTPException(409, f"can't pause a {job.status} job")
        out = JobOut.model_validate(job, from_attributes=True)
    request_pause(job_id)
    return out


@app.post("/jobs/{job_id}/resume", response_model=JobOut)
async def resume_job(job_id: str) -> JobOut:
    """Resume a paused job from where it stopped. Skips chunks that already
    have an attempt recorded — no re-paying for Shazam calls."""
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        if job.status != JobStatus.paused:
            raise HTTPException(409, f"can only resume a paused job (was {job.status})")
        job.status = JobStatus.running
        s.add(job)
        s.commit()
        out = JobOut.model_validate(job, from_attributes=True)
    asyncio.create_task(run_analysis(job_id, resume=True))
    return out


@app.post("/jobs/{job_id}/restart", response_model=JobOut)
async def restart_job(job_id: str) -> JobOut:
    """Re-analyse the same media as a brand-new job.

    We deliberately create a *new* job rather than mutate the old one — the old
    row stays as historical evidence (e.g. of when an interruption happened),
    and the worker's own wipe-and-rebuild logic on the new job is unchanged.
    """
    with session_scope() as s:
        old = s.get(AnalysisJob, job_id)
        if old is None:
            raise HTTPException(404, "job not found")
        new = AnalysisJob(media_asset_id=old.media_asset_id, status=JobStatus.queued)
        s.add(new)
        s.commit()
        s.refresh(new)
        out = JobOut.model_validate(new, from_attributes=True)

    asyncio.create_task(run_analysis(out.id))
    return out


@app.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str) -> JobOut:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        return JobOut.model_validate(job, from_attributes=True)


@app.get("/jobs/{job_id}/timeline", response_model=TimelineOut)
async def get_timeline(job_id: str) -> TimelineOut:
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        media = s.get(MediaAsset, job.media_asset_id)
        if media is None:
            raise HTTPException(500, "media missing for job")
        segments = s.exec(
            select(TimelineSegment)
            .where(TimelineSegment.analysis_job_id == job_id)
            .order_by(TimelineSegment.start_seconds, TimelineSegment.id)
        ).all()
        manual_tags = s.exec(
            select(ManualCorrection)
            .where(ManualCorrection.analysis_job_id == job_id)
            .order_by(ManualCorrection.start_seconds, ManualCorrection.id)
        ).all()
        # Count candidates so the UI can decide whether Rebuild is meaningful.
        from sqlalchemy import func

        candidate_count = s.exec(
            select(func.count(TrackCandidate.id)).where(
                TrackCandidate.analysis_job_id == job_id
            )
        ).one()
        return TimelineOut(
            job=JobOut.model_validate(job, from_attributes=True),
            media=MediaOut.model_validate(media, from_attributes=True),
            segments=[SegmentOut.model_validate(s_, from_attributes=True) for s_ in segments],
            manual_tags=[ManualTagOut.model_validate(t, from_attributes=True) for t in manual_tags],
            candidate_count=int(candidate_count or 0),
        )


@app.post("/jobs/{job_id}/manual-tags", response_model=ManualTagOut, status_code=201)
async def create_manual_tag(job_id: str, payload: ManualTagCreate) -> ManualTagOut:
    if payload.end_seconds <= payload.start_seconds:
        raise HTTPException(400, "end_seconds must be greater than start_seconds")
    with session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        if job is None:
            raise HTTPException(404, "job not found")
        tag = ManualCorrection(
            analysis_job_id=job_id,
            action="add",
            start_seconds=payload.start_seconds,
            end_seconds=payload.end_seconds,
            title=payload.title,
            artist=payload.artist,
            notes=payload.notes,
            external_urls=dict(payload.external_urls or {}),
        )
        s.add(tag)
        s.commit()
        s.refresh(tag)
        return ManualTagOut.model_validate(tag, from_attributes=True)


@app.delete("/manual-tags/{tag_id}", status_code=204)
async def delete_manual_tag(tag_id: str) -> None:
    with session_scope() as s:
        tag = s.get(ManualCorrection, tag_id)
        if tag is None:
            raise HTTPException(404, "manual tag not found")
        s.delete(tag)
        s.commit()


def _short_uuid() -> str:
    import uuid

    return uuid.uuid4().hex[:8]
