"""End-to-end API smoke test using the FakeCsvProvider so no network required."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

DATA = Path(__file__).resolve().parents[3] / "data"
GROOVE = DATA / "Groove_Cocktail_Deep_Touch_Karol_XVII_&_MB_Valence_Loco_Mix.mp3"


@pytest.fixture()
def client(monkeypatch, tmp_path):
    # Point storage + DB at a temp dir; force fake_csv provider so the test
    # is deterministic and never hits the network.
    monkeypatch.setenv("REKORD_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("REKORD_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("REKORD_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REKORD_PROVIDER", "fake_csv")
    monkeypatch.setenv("REKORD_FAKE_CSV_PATH", str(DATA / "set79_kyle_starkey_b2b_bella_claxton.csv"))

    # Reload settings + db modules so env vars take effect.
    import importlib

    import rekord.config as cfg
    import rekord.db as db
    importlib.reload(cfg)
    importlib.reload(db)
    import rekord.api.main as api
    importlib.reload(api)

    with TestClient(api.app) as c:
        yield c


@pytest.mark.skipif(not GROOVE.exists(), reason="Groove Cocktail fixture not present")
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200


def test_upload_unsupported_type_rejected(client, tmp_path):
    bad = tmp_path / "file.txt"
    bad.write_text("hello")
    with bad.open("rb") as fh:
        r = client.post("/media", files={"file": ("file.txt", fh, "text/plain")})
    assert r.status_code == 415
