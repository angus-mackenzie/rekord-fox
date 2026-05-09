import asyncio
from pathlib import Path

import pytest

from rekord.audio.chunker import ChunkWindow, plan_chunks
from rekord.providers.fake_csv import FakeCsvProvider, load_fake_tracks

CSV = Path(__file__).resolve().parents[3] / "data" / "set79_kyle_starkey_b2b_bella_claxton.csv"


@pytest.mark.skipif(not CSV.exists(), reason="set79 fixture not present")
def test_load_fake_tracks_skips_unknowns():
    tracks = load_fake_tracks(CSV)
    assert all(t.title.lower() != "unknown" for t in tracks)
    # CSV has 20 rows, 4 of which are 'Unknown' → 16 known.
    assert len(tracks) == 16


@pytest.mark.skipif(not CSV.exists(), reason="set79 fixture not present")
def test_fake_provider_returns_track_for_chunk_in_known_region():
    provider = FakeCsvProvider(CSV)
    # 5:00 falls inside the 4:47 'Funky Q Nice' segment.
    window = ChunkWindow(index=0, start_seconds=290.0, end_seconds=310.0)
    candidates = asyncio.run(provider.identify_chunk(Path("/dev/null"), window))
    assert len(candidates) == 1
    assert "funky q nice" in candidates[0].title.lower()
    assert candidates[0].confidence > 0.9
    # Spotify link parsed.
    assert "spotify" in candidates[0].external_urls


@pytest.mark.skipif(not CSV.exists(), reason="set79 fixture not present")
def test_fake_provider_empty_for_pre_first_track():
    provider = FakeCsvProvider(CSV)
    # 0:30 is before the first known track at 4:47.
    window = ChunkWindow(index=0, start_seconds=20.0, end_seconds=40.0)
    candidates = asyncio.run(provider.identify_chunk(Path("/dev/null"), window))
    assert candidates == []


@pytest.mark.skipif(not CSV.exists(), reason="set79 fixture not present")
def test_fake_provider_deterministic_across_full_set():
    provider = FakeCsvProvider(CSV)
    windows = plan_chunks(90 * 60, 20.0, 5.0)
    a = asyncio.run(_run_all(provider, windows))
    b = asyncio.run(_run_all(provider, windows))
    assert a == b


async def _run_all(provider, windows):
    out = []
    for w in windows:
        cands = await provider.identify_chunk(Path("/dev/null"), w)
        out.append([(c.title, c.artist, c.confidence) for c in cands])
    return out
