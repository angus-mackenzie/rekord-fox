from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

from ..audio.chunker import ChunkWindow
from .base import NormalizedCandidate, Provider


@dataclass(frozen=True)
class _CsvTrack:
    start_seconds: float
    title: str
    artist: str
    links: dict[str, str]


def _parse_hms(s: str) -> float:
    parts = s.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"bad time {s!r}")
    h, m, sec = (int(p) for p in parts)
    return h * 3600 + m * 60 + sec


def _split_links(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for url in (raw or "").split():
        if "spotify.com" in url:
            out.setdefault("spotify", url)
        elif "youtube.com" in url or "youtu.be" in url:
            out.setdefault("youtube", url)
        elif "soundcloud.com" in url:
            out.setdefault("soundcloud", url)
    return out


def _split_title_artist(raw: str) -> tuple[str, str]:
    """CSV column packs `Title - Artist` or `Artist - Title` inconsistently.
    Return (title, artist); fall back to (raw, '') when ambiguous.
    """
    if " - " not in raw:
        return raw.strip(), ""
    left, right = raw.rsplit(" - ", 1)
    # Heuristic: most rows are "Title - Artist".
    return left.strip(), right.strip()


def load_fake_tracks(csv_path: Path) -> list[_CsvTrack]:
    tracks: list[_CsvTrack] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("Track Name") or ""
            if not name or name.strip().lower() == "unknown":
                continue
            title, artist = _split_title_artist(name)
            tracks.append(
                _CsvTrack(
                    start_seconds=_parse_hms(row["Start Time"]),
                    title=re.sub(r"\s+", " ", title),
                    artist=artist,
                    links=_split_links(row.get("Links") or ""),
                )
            )
    tracks.sort(key=lambda t: t.start_seconds)
    return tracks


class FakeCsvProvider(Provider):
    """Deterministic provider seeded from a tracklist CSV.

    For each chunk window, returns the track whose start time falls within
    [chunk.start, chunk.end). Confidence is fixed so timeline tests are stable.
    """

    name = "fake_csv"

    def __init__(self, csv_path: Path, confidence: float = 0.95) -> None:
        self._tracks = load_fake_tracks(csv_path)
        self._confidence = confidence

    async def identify_chunk(
        self, audio_path: Path, window: ChunkWindow
    ) -> list[NormalizedCandidate]:
        active = self._track_at(window.start_seconds + window.duration / 2)
        if active is None:
            return []
        return [
            NormalizedCandidate(
                provider=self.name,
                title=active.title,
                artist=active.artist,
                confidence=self._confidence,
                external_urls=active.links,
                metadata={"source_csv_start": active.start_seconds},
            )
        ]

    def _track_at(self, t: float) -> _CsvTrack | None:
        active: _CsvTrack | None = None
        for tr in self._tracks:
            if tr.start_seconds <= t:
                active = tr
            else:
                break
        return active
