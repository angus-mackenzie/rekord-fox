"""Manual tags: create, list (via /timeline), delete, and range-stream the audio."""
from __future__ import annotations

import importlib
from pathlib import Path

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
        yield c, db


def _seed_media_and_job(db, tmp_path: Path) -> tuple[str, str, Path]:
    """Create a real on-disk file (4 KB of zeros stand in for audio bytes —
    enough for the range-streaming test, no ffmpeg involved)."""
    from rekord.models import AnalysisJob, JobStatus, MediaAsset

    audio = tmp_path / "track.mp3"
    audio.write_bytes(b"\x00" * 4096)
    with db.session_scope() as s:
        media = MediaAsset(
            original_filename="track.mp3",
            content_type="audio/mpeg",
            storage_path=str(audio),
            checksum="0",
            duration_seconds=60.0,
        )
        s.add(media)
        s.commit()
        job = AnalysisJob(media_asset_id=media.id, status=JobStatus.succeeded, progress=1.0)
        s.add(job)
        s.commit()
        return media.id, job.id, audio


def test_create_manual_tag_appears_in_timeline(client, tmp_path):
    c, db = client
    _, job_id, _ = _seed_media_and_job(db, tmp_path)

    r = c.post(
        f"/jobs/{job_id}/manual-tags",
        json={
            "start_seconds": 30.0,
            "end_seconds": 45.5,
            "title": "Mystery Track",
            "artist": "Unknown Artist",
            "external_urls": {"spotify": "https://open.spotify.com/track/abc"},
        },
    )
    assert r.status_code == 201, r.text
    tag = r.json()
    assert tag["start_seconds"] == 30.0
    assert tag["end_seconds"] == 45.5
    assert tag["action"] == "add"
    assert tag["external_urls"]["spotify"].endswith("/abc")

    tl = c.get(f"/jobs/{job_id}/timeline").json()
    assert len(tl["manual_tags"]) == 1
    assert tl["manual_tags"][0]["title"] == "Mystery Track"


def test_create_manual_tag_rejects_zero_or_negative_window(client, tmp_path):
    c, db = client
    _, job_id, _ = _seed_media_and_job(db, tmp_path)
    for bad in [(10.0, 10.0), (20.0, 5.0)]:
        r = c.post(
            f"/jobs/{job_id}/manual-tags",
            json={"start_seconds": bad[0], "end_seconds": bad[1]},
        )
        assert r.status_code == 400


def test_delete_manual_tag(client, tmp_path):
    c, db = client
    _, job_id, _ = _seed_media_and_job(db, tmp_path)
    tid = c.post(
        f"/jobs/{job_id}/manual-tags",
        json={"start_seconds": 0.0, "end_seconds": 10.0, "title": "X"},
    ).json()["id"]
    assert c.delete(f"/manual-tags/{tid}").status_code == 204
    tl = c.get(f"/jobs/{job_id}/timeline").json()
    assert tl["manual_tags"] == []


def test_delete_job_cascades_to_manual_tags(client, tmp_path):
    c, db = client
    _, job_id, _ = _seed_media_and_job(db, tmp_path)
    c.post(
        f"/jobs/{job_id}/manual-tags",
        json={"start_seconds": 0.0, "end_seconds": 10.0, "title": "X"},
    )
    from sqlmodel import select

    from rekord.models import ManualCorrection
    with db.session_scope() as s:
        assert len(s.exec(select(ManualCorrection)).all()) == 1
    assert c.delete(f"/jobs/{job_id}").status_code == 204
    with db.session_scope() as s:
        assert s.exec(select(ManualCorrection)).all() == []


def test_audio_endpoint_serves_full_file_when_no_range(client, tmp_path):
    c, db = client
    media_id, _, audio = _seed_media_and_job(db, tmp_path)
    r = c.get(f"/media/{media_id}/audio")
    assert r.status_code == 200
    assert r.headers["accept-ranges"] == "bytes"
    assert len(r.content) == audio.stat().st_size


def test_audio_endpoint_honours_range_request(client, tmp_path):
    c, db = client
    media_id, _, audio = _seed_media_and_job(db, tmp_path)
    audio.write_bytes(bytes(range(256)) * 16)  # 4096 bytes of recognisable data

    r = c.get(f"/media/{media_id}/audio", headers={"Range": "bytes=100-199"})
    assert r.status_code == 206
    assert r.headers["content-range"] == f"bytes 100-199/{audio.stat().st_size}"
    assert r.headers["content-length"] == "100"
    assert r.content == audio.read_bytes()[100:200]


def test_audio_endpoint_416_when_range_outside_file(client, tmp_path):
    c, db = client
    media_id, _, audio = _seed_media_and_job(db, tmp_path)
    size = audio.stat().st_size
    r = c.get(f"/media/{media_id}/audio", headers={"Range": f"bytes={size + 10}-"})
    assert r.status_code == 416


def test_audio_endpoint_410_when_underlying_file_missing(client, tmp_path):
    c, db = client
    media_id, _, audio = _seed_media_and_job(db, tmp_path)
    audio.unlink()
    r = c.get(f"/media/{media_id}/audio")
    assert r.status_code == 410
