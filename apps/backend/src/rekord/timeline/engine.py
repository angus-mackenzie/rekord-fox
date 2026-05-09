from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ..audio.chunker import ChunkWindow
from ..config import settings
from ..models import SegmentState
from ..providers.base import NormalizedCandidate


@dataclass
class ChunkResult:
    window: ChunkWindow
    candidates: list[NormalizedCandidate]


@dataclass
class ReconstructedSegment:
    start_seconds: float
    end_seconds: float
    state: SegmentState
    confidence: float
    title: str | None
    artist: str | None
    candidates: list[dict] = field(default_factory=list)
    notes: str | None = None


def _key(c: NormalizedCandidate) -> tuple[str, str]:
    return (c.title.strip().lower(), c.artist.strip().lower())


def _candidate_payload(c: NormalizedCandidate) -> dict:
    return {
        "provider": c.provider,
        "title": c.title,
        "artist": c.artist,
        "confidence": c.confidence,
        "external_urls": dict(c.external_urls),
        "album": c.album,
        "artwork_url": c.artwork_url,
        "provider_track_id": c.provider_track_id,
    }


@dataclass
class _Cluster:
    """A run of chunk-indices where the same track was identified.

    Two appearances of the same track key fold into one cluster as long as the
    gap between them is no more than `max_gap_chunks` — this is what lets
    sparse, noisy Shazam matches like A . A . A still produce one segment.
    """

    key: tuple[str, str]
    chunk_indices: list[int]
    candidates: list[NormalizedCandidate]

    @property
    def support(self) -> int:
        return len(self.chunk_indices)

    @property
    def first(self) -> int:
        return self.chunk_indices[0]

    @property
    def last(self) -> int:
        return self.chunk_indices[-1]

    @property
    def avg_confidence(self) -> float:
        return sum(c.confidence for c in self.candidates) / len(self.candidates)

    @property
    def primary(self) -> NormalizedCandidate:
        # Stable: highest confidence, then provider name, then title.
        return sorted(
            self.candidates, key=lambda c: (-c.confidence, c.provider, c.title)
        )[0]


def _build_clusters(
    chunks: list[ChunkResult], max_gap_chunks: int
) -> list[_Cluster]:
    """Group same-track appearances by chunk-index proximity.

    For each unique (title, artist) key, walk the sorted appearance indices and
    start a new cluster whenever the gap to the previous appearance exceeds
    `max_gap_chunks`. This treats `A . . . A` (small gap) as one play of A and
    `A . . . . . . . A` (large gap) as two separate plays.
    """
    appearances: dict[tuple[str, str], list[tuple[int, NormalizedCandidate]]] = (
        defaultdict(list)
    )
    for i, cr in enumerate(chunks):
        for cand in cr.candidates:
            appearances[_key(cand)].append((i, cand))

    clusters: list[_Cluster] = []
    # Sort keys for determinism so cluster order doesn't depend on dict insertion order.
    for key in sorted(appearances.keys()):
        apps = sorted(appearances[key], key=lambda a: a[0])
        cur_idxs: list[int] = [apps[0][0]]
        cur_cands: list[NormalizedCandidate] = [apps[0][1]]
        for idx, cand in apps[1:]:
            if idx - cur_idxs[-1] <= max_gap_chunks:
                cur_idxs.append(idx)
                cur_cands.append(cand)
            else:
                clusters.append(_Cluster(key, cur_idxs, cur_cands))
                cur_idxs, cur_cands = [idx], [cand]
        clusters.append(_Cluster(key, cur_idxs, cur_cands))
    return clusters


def _state_for_cluster(support: int, avg_conf: float) -> SegmentState:
    if support >= 3 and avg_conf >= settings.confidence_likely:
        return SegmentState.confirmed
    if support >= 2 and avg_conf >= settings.confidence_likely:
        return SegmentState.likely
    if support >= 2 and avg_conf >= settings.confidence_uncertain:
        return SegmentState.uncertain
    if support == 1 and avg_conf >= settings.confidence_confirmed:
        # Strong single-chunk hit (e.g. short interlude track) — keep but mark uncertain
        # since we have no temporal corroboration.
        return SegmentState.uncertain
    return SegmentState.uncertain


def reconstruct_timeline(
    chunk_results: list[ChunkResult],
    max_gap_chunks: int | None = None,
) -> list[ReconstructedSegment]:
    """Fuse per-chunk candidates into a stable, deterministic timeline.

    Algorithm (cluster-based):
      1. Per-chunk candidates are collected per track key.
      2. Each track's appearances are clustered by chunk-index proximity:
         within `max_gap_chunks` of each other → same play.
      3. Clusters are ranked by (support DESC, avg-confidence DESC, key ASC).
         The strongest-supported cluster claims every chunk in its
         [first..last] span; weaker overlapping clusters become competing
         candidates on the chunks they touch.
      4. Consecutive chunks with the same winning cluster collapse into one
         segment. Chunks with no cluster claim are emitted as `unresolved`.

    Why this matters: a 5-minute track that Shazam recognises only on every
    second chunk (e.g. A . A . A . A) becomes one segment, not seven, and
    isolated false-positive matches between those hits (B, C, D) are demoted
    to competing candidates inside the A segment instead of producing
    fragmented micro-segments.

    Identical inputs produce identical outputs.
    """
    if not chunk_results:
        return []

    if max_gap_chunks is None:
        max_gap_chunks = settings.cluster_max_gap_chunks

    chunks = sorted(chunk_results, key=lambda r: r.window.start_seconds)
    n = len(chunks)

    clusters = _build_clusters(chunks, max_gap_chunks)
    clusters_ranked = sorted(
        clusters,
        key=lambda c: (-c.support, -c.avg_confidence, c.key),
    )

    chunk_winner: list[_Cluster | None] = [None] * n
    chunk_competing: list[list[_Cluster]] = [[] for _ in range(n)]
    for cluster in clusters_ranked:
        for i in range(cluster.first, cluster.last + 1):
            if chunk_winner[i] is None:
                chunk_winner[i] = cluster
            elif chunk_winner[i] is not cluster:
                if cluster not in chunk_competing[i]:
                    chunk_competing[i].append(cluster)

    segments: list[ReconstructedSegment] = []
    i = 0
    while i < n:
        winner = chunk_winner[i]
        j = i
        while j < n and chunk_winner[j] is winner:
            j += 1
        start = chunks[i].window.start_seconds
        end = chunks[j - 1].window.end_seconds

        if winner is None:
            segments.append(
                ReconstructedSegment(
                    start_seconds=start,
                    end_seconds=end,
                    state=SegmentState.unresolved,
                    confidence=0.0,
                    title=None,
                    artist=None,
                    candidates=[],
                    notes="no provider match",
                )
            )
            i = j
            continue

        avg_conf = winner.avg_confidence
        state = _state_for_cluster(winner.support, avg_conf)

        # Build candidate payload: winner first, then any competing clusters
        # that touched chunks in this run, deduplicated and ranked.
        primary_payload = _candidate_payload(winner.primary)
        competing: dict[tuple[str, str], _Cluster] = {}
        for k in range(i, j):
            for comp in chunk_competing[k]:
                if comp.key == winner.key:
                    continue
                competing.setdefault(comp.key, comp)
        cand_payload: list[dict] = [primary_payload]
        for c in sorted(
            competing.values(),
            key=lambda c: (-c.support, -c.avg_confidence, c.key),
        ):
            cand_payload.append(_candidate_payload(c.primary))

        segments.append(
            ReconstructedSegment(
                start_seconds=start,
                end_seconds=end,
                state=state,
                confidence=avg_conf,
                title=winner.primary.title,
                artist=winner.primary.artist,
                candidates=cand_payload,
            )
        )
        i = j

    return segments
