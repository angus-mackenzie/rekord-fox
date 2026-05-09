"""rebuild-timeline replays the current fusion algorithm over stored candidates.

Guards against the regression where an old job analysed under the previous
chunk-by-chunk algorithm shows fragmented segments. Rebuild should produce the
same output as a fresh analysis (since both use reconstruct_timeline), but
without paying for provider calls.
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("REKORD_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("REKORD_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("REKORD_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REKORD_PROVIDER", "fake_csv")
    import rekord.config as cfg
    import rekord.db as db
    importlib.reload(cfg)
    importlib.reload(db)
    import rekord.api.main as api
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c, db, api


def _seed(db, api, fragmented_segments: int):
    """Seed a job with the user's noisy A B A C A D A E F E E E pattern stored
    as raw candidates plus a deliberately-fragmented set of segments to mimic
    output from the old fusion algorithm.
    """
    from rekord.models import (
        AnalysisJob,
        JobStatus,
        MediaAsset,
        SegmentState,
        TimelineSegment,
        TrackCandidate,
    )

    with db.session_scope() as s:
        media = MediaAsset(
            original_filename="x.mp3",
            content_type="audio/mp3",
            storage_path="/tmp/x.mp3",
            checksum="0",
            duration_seconds=180.0,
        )
        s.add(media)
        s.commit()
        job = AnalysisJob(
            media_asset_id=media.id, status=JobStatus.succeeded, progress=1.0
        )
        s.add(job)
        s.commit()
        seq = ["A", "B", "A", "C", "A", "D", "A", "E", "F", "E", "E", "E"]
        for i, t in enumerate(seq):
            s.add(
                TrackCandidate(
                    analysis_job_id=job.id,
                    provider="fake",
                    chunk_start_seconds=i * 15.0,
                    chunk_end_seconds=i * 15.0 + 20.0,
                    title=t,
                    artist="A",
                    confidence=0.95,
                )
            )
        # Fake "old fragmented" segments (one per chunk).
        for i, t in enumerate(seq[:fragmented_segments]):
            s.add(
                TimelineSegment(
                    analysis_job_id=job.id,
                    start_seconds=i * 15.0,
                    end_seconds=i * 15.0 + 20.0,
                    state=SegmentState.likely,
                    confidence=0.9,
                    title=t,
                    artist="A",
                    candidates=[],
                )
            )
        s.commit()
        return job.id


def test_rebuild_replaces_fragmented_segments_with_clustered_ones(client):
    c, db, api = client
    job_id = _seed(db, api, fragmented_segments=12)
    # Sanity: pre-rebuild has 12 fragmented segments.
    pre = c.get(f"/jobs/{job_id}/timeline").json()
    assert len(pre["segments"]) == 12

    # Rebuild should fuse to two segments (A then E) per the cluster algorithm.
    r = c.post(f"/jobs/{job_id}/rebuild-timeline")
    assert r.status_code == 200
    post = c.get(f"/jobs/{job_id}/timeline").json()
    titles = [s["title"] for s in post["segments"]]
    assert titles == ["A", "E"]


def test_rebuild_404_when_job_missing(client):
    c, _, _ = client
    r = c.post("/jobs/does-not-exist/rebuild-timeline")
    assert r.status_code == 404


def test_rebuild_409_when_no_candidates(client):
    c, db, _ = client
    from rekord.models import AnalysisJob, JobStatus, MediaAsset

    with db.session_scope() as s:
        media = MediaAsset(
            original_filename="x.mp3",
            content_type="audio/mp3",
            storage_path="/tmp/x.mp3",
            checksum="0",
            duration_seconds=10.0,
        )
        s.add(media)
        s.commit()
        job = AnalysisJob(media_asset_id=media.id, status=JobStatus.succeeded)
        s.add(job)
        s.commit()
        jid = job.id
    r = c.post(f"/jobs/{jid}/rebuild-timeline")
    assert r.status_code == 409
