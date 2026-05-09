from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from shazamio import Shazam

from ..audio.chunker import ChunkWindow
from .base import NormalizedCandidate, Provider

log = logging.getLogger(__name__)


class ShazamProvider(Provider):
    """Real-world recognition via the (unofficial) Shazam mobile API.

    Returns at most one candidate per chunk. Confidence is synthesized from
    Shazam match strength signals (it does not expose a probability), so we
    treat any positive recognition as high-confidence (0.9) and absence as
    no candidates at all.
    """

    name = "shazam"

    def __init__(self) -> None:
        self._shazam = Shazam()

    async def identify_chunk(
        self, audio_path: Path, window: ChunkWindow
    ) -> list[NormalizedCandidate]:
        try:
            result: dict[str, Any] = await self._shazam.recognize(str(audio_path))
        except Exception as exc:  # noqa: BLE001 — provider boundary, never crash worker
            log.warning("shazam recognize failed at %.2fs: %s", window.start_seconds, exc)
            return []

        track = result.get("track")
        if not track:
            return []

        title = track.get("title") or ""
        artist = track.get("subtitle") or ""
        if not title:
            return []

        external_urls = _extract_external_urls(track)
        artwork_url = (track.get("images") or {}).get("coverart")

        return [
            NormalizedCandidate(
                provider=self.name,
                title=title,
                artist=artist,
                confidence=0.9,
                provider_track_id=str(track.get("key")) if track.get("key") else None,
                album=_extract_album(track),
                artwork_url=artwork_url,
                external_urls=external_urls,
                metadata={"raw": track},
            )
        ]


def _extract_album(track: dict[str, Any]) -> str | None:
    sections = track.get("sections") or []
    for section in sections:
        for meta in section.get("metadata", []) or []:
            if (meta.get("title") or "").lower() == "album":
                return meta.get("text")
    return None


def _extract_external_urls(track: dict[str, Any]) -> dict[str, str]:
    urls: dict[str, str] = {}
    hub = track.get("hub") or {}
    for action in hub.get("actions", []) or []:
        if action.get("type") == "applemusicplay" and action.get("uri"):
            urls.setdefault("apple_music", action["uri"])
    for provider in hub.get("providers", []) or []:
        ptype = (provider.get("type") or "").lower()
        for action in provider.get("actions", []) or []:
            uri = action.get("uri")
            if not uri:
                continue
            if "spotify" in ptype or "spotify" in uri:
                urls.setdefault("spotify", uri)
    if track.get("url"):
        urls.setdefault("shazam", track["url"])
    if track.get("share", {}).get("href"):
        urls.setdefault("share", track["share"]["href"])
    return urls
