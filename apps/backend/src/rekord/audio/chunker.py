from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkWindow:
    index: int
    start_seconds: float
    end_seconds: float

    @property
    def duration(self) -> float:
        return self.end_seconds - self.start_seconds


def plan_chunks(
    duration_seconds: float,
    window: float,
    overlap: float,
) -> list[ChunkWindow]:
    """Plan deterministic overlapping chunk windows covering [0, duration].

    Step is window-overlap. The last chunk is clamped to the duration to avoid
    decoding past EOF. Identical inputs always produce identical windows.
    """
    if window <= 0:
        raise ValueError("window must be positive")
    if overlap < 0 or overlap >= window:
        raise ValueError("overlap must satisfy 0 <= overlap < window")
    if duration_seconds <= 0:
        return []

    step = window - overlap
    chunks: list[ChunkWindow] = []
    start = 0.0
    i = 0
    while start < duration_seconds:
        end = min(start + window, duration_seconds)
        chunks.append(ChunkWindow(index=i, start_seconds=start, end_seconds=end))
        if end >= duration_seconds:
            break
        start += step
        i += 1
    return chunks
