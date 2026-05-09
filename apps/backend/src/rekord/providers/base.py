from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..audio.chunker import ChunkWindow


@dataclass
class NormalizedCandidate:
    """Provider-agnostic normalized output for one chunk.

    Provider-specific data lives only in `metadata`. Shared systems must not branch
    on provider names except for configuration, weighting, observability, or
    metadata display (per docs/INVARIANTS.md).
    """

    provider: str
    title: str
    artist: str
    confidence: float
    provider_track_id: str | None = None
    album: str | None = None
    artwork_url: str | None = None
    external_urls: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class Provider(ABC):
    """Provider interface. Implementations must be stateless across calls."""

    name: str

    @abstractmethod
    async def identify_chunk(
        self, audio_path: Path, window: ChunkWindow
    ) -> list[NormalizedCandidate]:
        """Return zero or more normalized candidates for an audio chunk file."""
