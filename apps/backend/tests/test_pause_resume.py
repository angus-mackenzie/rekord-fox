"""Pause/resume mechanics: chunk attempts persist, resume skips them."""
from __future__ import annotations

import asyncio
import importlib
from pathlib import Path

import pytest
from sqlmodel import select

DATA = Path(__file__).resolve().parents[3] / "data"
GROOVE = DATA / "Groove_Cocktail_Deep_Touch_Karol_XVII_&_MB_Valence_Loco_Mix.mp3"


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("REKORD_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("REKORD_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("REKORD_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REKORD_PROVIDER", "fake_csv")
    import rekord.config as cfg
    import rekord.db as db
    importlib.reload(cfg)
    importlib.reload(db)
    db.init_db()
    # Force concurrency=1 in the live `settings` instance the worker module
    # already imported. Using monkeypatch.setattr on the imported binding
    # rather than env vars + reload, since pipeline.py captured `settings` at
    # import time and a config reload doesn't rebind it.
    from rekord.worker import pipeline as wp
    monkeypatch.setattr(wp.settings, "provider_concurrency", 1)
    return db


def _seed_media_and_job(db, src: Path, duration: float = 60.0):
    from rekord.audio.ffmpeg import file_checksum
    from rekord.models import AnalysisJob, JobStatus, MediaAsset

    with db.session_scope() as s:
        media = MediaAsset(
            original_filename=src.name,
            content_type="audio/mp3",
            storage_path=str(src),
            checksum=file_checksum(src),
            duration_seconds=duration,
        )
        s.add(media)
        s.commit()
        job = AnalysisJob(media_asset_id=media.id, status=JobStatus.queued)
        s.add(job)
        s.commit()
        return job.id


@pytest.mark.skipif(not GROOVE.exists(), reason="Groove Cocktail fixture not present")
def test_resume_skips_already_attempted_chunks(env, monkeypatch):
    """Run analysis once, pause partway, then resume — provider should not be
    called again for chunks that were already attempted in run 1.
    """
    from rekord.models import AnalysisJob, ChunkAttempt, JobStatus
    from rekord.providers.base import NormalizedCandidate, Provider
    from rekord.worker import pipeline as wp

    call_count = 0

    class CountingProvider(Provider):
        name = "counting"

        async def identify_chunk(self, audio_path, window):
            nonlocal call_count
            # Yield to event loop so external code (the pause trigger below)
            # gets a chance to run between chunk completions.
            await asyncio.sleep(0)
            call_count += 1
            return [
                NormalizedCandidate(
                    provider=self.name, title=f"T{window.index}", artist="A", confidence=0.9
                )
            ]

    monkeypatch.setattr(wp, "get_provider", lambda *_a, **_k: CountingProvider())

    job_id = _seed_media_and_job(env, GROOVE, duration=120.0)  # ~8 chunks

    # Drive a pause from outside: spawn a task that waits a moment then calls
    # request_pause(). This is exactly what the API endpoint does.
    async def run_with_external_pause():
        analysis_task = asyncio.create_task(wp.run_analysis(job_id))
        # Let a few chunks finish first.
        await asyncio.sleep(0.05)
        wp.request_pause(job_id)
        await analysis_task

    asyncio.run(run_with_external_pause())

    with env.session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        attempts_after_pause = list(s.exec(
            select(ChunkAttempt).where(ChunkAttempt.analysis_job_id == job_id)
        ).all())
        n_after_pause = len(attempts_after_pause)
        assert job.status == JobStatus.paused, f"expected paused, got {job.status}"
        # Some chunks completed, but not all — pause must have stopped progress.
        windows_planned = 8  # 120s / (20-5) step + last clamped, see chunker
        assert 0 < n_after_pause < windows_planned, (
            f"expected partial progress, got {n_after_pause}/{windows_planned}"
        )

    calls_after_pause = call_count

    # Resume — should only invoke provider for the remaining chunks.
    asyncio.run(wp.run_analysis(job_id, resume=True))

    with env.session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        attempts_final = list(s.exec(
            select(ChunkAttempt).where(ChunkAttempt.analysis_job_id == job_id)
        ).all())
        assert job.status == JobStatus.succeeded
        assert len(attempts_final) > n_after_pause

    # Provider must have been called exactly once per remaining window across
    # the resume — never re-paying for what run 1 already did.
    extra_calls = call_count - calls_after_pause
    new_attempts = len(attempts_final) - n_after_pause
    assert extra_calls == new_attempts


@pytest.mark.skipif(not GROOVE.exists(), reason="Groove Cocktail fixture not present")
def test_resume_with_no_remaining_chunks_finalizes(env, monkeypatch):
    """If everything was attempted before pause (edge case), resume just
    finalizes the timeline — doesn't error out."""
    from rekord.models import AnalysisJob, JobStatus
    from rekord.providers.base import NormalizedCandidate, Provider
    from rekord.worker import pipeline as wp

    class FastProvider(Provider):
        name = "fast"

        async def identify_chunk(self, audio_path, window):
            return [
                NormalizedCandidate(
                    provider=self.name, title="X", artist="Y", confidence=0.9
                )
            ]

    monkeypatch.setattr(wp, "get_provider", lambda *_a, **_k: FastProvider())

    job_id = _seed_media_and_job(env, GROOVE, duration=30.0)

    asyncio.run(wp.run_analysis(job_id))
    with env.session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        assert job.status == JobStatus.succeeded
        # Force into paused-but-fully-attempted state to simulate the edge case.
        job.status = JobStatus.paused
        s.add(job)
        s.commit()

    asyncio.run(wp.run_analysis(job_id, resume=True))
    with env.session_scope() as s:
        job = s.get(AnalysisJob, job_id)
        assert job.status == JobStatus.succeeded
