"""Server-restart recovery: orphaned running/queued jobs are marked failed."""
from __future__ import annotations

import importlib

import pytest


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
    return db


def test_orphaned_jobs_marked_paused_on_startup(env, tmp_path):
    """Interrupted jobs become `paused` (not `failed`) so progress is preserved
    and the user can resume them from where the worker stopped."""
    from rekord.api.main import _recover_orphaned_jobs
    from rekord.models import AnalysisJob, JobStatus, MediaAsset

    env.init_db()
    with env.session_scope() as s:
        media = MediaAsset(
            original_filename="x.mp3",
            content_type="audio/mp3",
            storage_path=str(tmp_path / "x.mp3"),
            checksum="0",
            duration_seconds=60.0,
        )
        s.add(media)
        s.commit()
        running = AnalysisJob(media_asset_id=media.id, status=JobStatus.running, progress=0.4)
        queued = AnalysisJob(media_asset_id=media.id, status=JobStatus.queued)
        succeeded = AnalysisJob(media_asset_id=media.id, status=JobStatus.succeeded, progress=1.0)
        paused = AnalysisJob(media_asset_id=media.id, status=JobStatus.paused, progress=0.5)
        s.add_all([running, queued, succeeded, paused])
        s.commit()
        rid, qid, sid, pid = running.id, queued.id, succeeded.id, paused.id

    _recover_orphaned_jobs()

    with env.session_scope() as s:
        assert s.get(AnalysisJob, rid).status == JobStatus.paused
        assert s.get(AnalysisJob, qid).status == JobStatus.paused
        # Untouched: succeeded and already-paused jobs unchanged.
        assert s.get(AnalysisJob, sid).status == JobStatus.succeeded
        assert s.get(AnalysisJob, pid).status == JobStatus.paused
        # Recovered jobs carry an explanatory message + error_code so the UI
        # can show "Interrupted — Resume" copy.
        assert s.get(AnalysisJob, rid).error_code == "interrupted"
        assert "resume" in (s.get(AnalysisJob, rid).error_message or "").lower()
        # Recovered job's progress is preserved so the UI bar reflects how far
        # the worker got before the interruption.
        assert s.get(AnalysisJob, rid).progress == 0.4


def test_recovery_is_noop_when_no_orphans(env):
    from rekord.api.main import _recover_orphaned_jobs

    env.init_db()
    # Nothing in the DB → must not raise.
    _recover_orphaned_jobs()
