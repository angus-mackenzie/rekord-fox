from rekord.audio.chunker import ChunkWindow
from rekord.models import SegmentState
from rekord.providers.base import NormalizedCandidate
from rekord.timeline import ChunkResult, reconstruct_timeline


def _w(i, start, end):
    return ChunkWindow(index=i, start_seconds=start, end_seconds=end)


def _c(title, artist="A", conf=0.95, provider="fake"):
    return NormalizedCandidate(provider=provider, title=title, artist=artist, confidence=conf)


def test_empty_input_yields_empty_timeline():
    assert reconstruct_timeline([]) == []


def test_consecutive_same_track_merges():
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("Song")]),
        ChunkResult(_w(1, 15, 35), [_c("Song")]),
        ChunkResult(_w(2, 30, 50), [_c("Song")]),
    ]
    segs = reconstruct_timeline(chunks)
    assert len(segs) == 1
    assert segs[0].title == "Song"
    assert segs[0].state == SegmentState.confirmed
    assert segs[0].start_seconds == 0
    assert segs[0].end_seconds == 50


def test_track_change_creates_separate_segments():
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), [_c("A")]),
        ChunkResult(_w(2, 30, 50), [_c("B")]),
        ChunkResult(_w(3, 45, 65), [_c("B")]),
    ]
    segs = reconstruct_timeline(chunks)
    assert [s.title for s in segs] == ["A", "B"]


def test_unmatched_chunk_becomes_unresolved():
    chunks = [
        ChunkResult(_w(0, 0, 20), []),
        ChunkResult(_w(1, 15, 35), []),
    ]
    segs = reconstruct_timeline(chunks)
    assert len(segs) == 1
    assert segs[0].state == SegmentState.unresolved


def test_one_chunk_gap_filled_when_neighbours_agree():
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("Song")]),
        ChunkResult(_w(1, 15, 35), []),
        ChunkResult(_w(2, 30, 50), [_c("Song")]),
    ]
    segs = reconstruct_timeline(chunks)
    assert len(segs) == 1
    assert segs[0].title == "Song"


def test_one_chunk_gap_not_filled_when_neighbours_disagree():
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), []),
        ChunkResult(_w(2, 30, 50), [_c("B")]),
    ]
    segs = reconstruct_timeline(chunks)
    states = [s.state for s in segs]
    assert SegmentState.unresolved in states


def test_low_confidence_marks_uncertain():
    chunks = [ChunkResult(_w(0, 0, 20), [_c("Song", conf=0.4)])]
    segs = reconstruct_timeline(chunks)
    assert segs[0].state == SegmentState.uncertain


def test_competing_candidates_are_preserved():
    chunks = [
        ChunkResult(
            _w(0, 0, 20),
            [_c("Winner", conf=0.9, provider="p1"), _c("Loser", conf=0.7, provider="p2")],
        ),
    ]
    segs = reconstruct_timeline(chunks)
    titles = {c["title"] for c in segs[0].candidates}
    assert {"Winner", "Loser"} <= titles
    assert segs[0].title == "Winner"


def test_noisy_alternating_matches_collate_to_two_segments():
    """A B A C A D A E F E E E should produce two segments: A then E.

    The intermediate single-chunk hits (B, C, D, F) are false-positives the
    cluster algorithm should demote to competing candidates inside the
    dominant track's segment, not separate micro-segments.
    """
    seq = ["A", "B", "A", "C", "A", "D", "A", "E", "F", "E", "E", "E"]
    chunks = [
        ChunkResult(_w(i, i * 15.0, i * 15.0 + 20.0), [_c(t)])
        for i, t in enumerate(seq)
    ]
    segs = reconstruct_timeline(chunks)
    assert [s.title for s in segs] == ["A", "E"]
    # A's segment should span chunks 0–6 (last A appearance), E's chunks 7–11.
    assert segs[0].end_seconds >= chunks[6].window.end_seconds
    assert segs[1].start_seconds <= chunks[7].window.start_seconds
    # B/C/D should appear as competing candidates inside A's segment.
    a_competing = {c["title"] for c in segs[0].candidates if c["title"] != "A"}
    assert {"B", "C", "D"} <= a_competing


def test_sparse_real_track_with_dropouts_stays_one_segment():
    """A . A . A . A — Shazam misses every other chunk, but A is one play."""
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), []),
        ChunkResult(_w(2, 30, 50), [_c("A")]),
        ChunkResult(_w(3, 45, 65), []),
        ChunkResult(_w(4, 60, 80), [_c("A")]),
        ChunkResult(_w(5, 75, 95), []),
        ChunkResult(_w(6, 90, 110), [_c("A")]),
    ]
    segs = reconstruct_timeline(chunks)
    assert len(segs) == 1
    assert segs[0].title == "A"
    assert segs[0].state == SegmentState.confirmed


def test_long_gap_splits_same_track_into_two_plays():
    """A track played twice in the mix with a big gap → two A segments."""
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), [_c("A")]),
        ChunkResult(_w(2, 30, 50), [_c("A")]),
        # 7 empty chunks > max_gap_chunks (5)
        *[ChunkResult(_w(i, i * 15.0, i * 15.0 + 20.0), []) for i in range(3, 10)],
        ChunkResult(_w(10, 150, 170), [_c("A")]),
        ChunkResult(_w(11, 165, 185), [_c("A")]),
        ChunkResult(_w(12, 180, 200), [_c("A")]),
    ]
    segs = reconstruct_timeline(chunks)
    a_segs = [s for s in segs if s.title == "A"]
    assert len(a_segs) == 2


def test_overlapping_transition_keeps_both_as_competing():
    """Smooth A→B transition: A wins by support, B preserved as competitor."""
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), [_c("A")]),
        ChunkResult(_w(2, 30, 50), [_c("A"), _c("B", conf=0.8)]),
        ChunkResult(_w(3, 45, 65), [_c("B"), _c("A", conf=0.8)]),
        ChunkResult(_w(4, 60, 80), [_c("B")]),
        ChunkResult(_w(5, 75, 95), [_c("B")]),
    ]
    segs = reconstruct_timeline(chunks)
    titles = [s.title for s in segs]
    assert "A" in titles and "B" in titles
    # A's segment should mention B as a competitor (it appeared during A's run).
    a_seg = next(s for s in segs if s.title == "A")
    assert any(c["title"] == "B" for c in a_seg.candidates)


def test_max_gap_chunks_is_configurable():
    """Same input, different gap tolerance → different segment count."""
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A")]),
        ChunkResult(_w(1, 15, 35), []),
        ChunkResult(_w(2, 30, 50), []),
        ChunkResult(_w(3, 45, 65), []),
        ChunkResult(_w(4, 60, 80), [_c("A")]),
    ]
    # Tight gap → A appearances at 0 and 4 (gap=4) don't merge
    tight = reconstruct_timeline(chunks, max_gap_chunks=2)
    a_tight = [s for s in tight if s.title == "A"]
    assert len(a_tight) == 2
    # Loose gap → they merge into one
    loose = reconstruct_timeline(chunks, max_gap_chunks=5)
    a_loose = [s for s in loose if s.title == "A"]
    assert len(a_loose) == 1


def test_deterministic_on_repeated_calls():
    chunks = [
        ChunkResult(_w(0, 0, 20), [_c("A", conf=0.9), _c("B", conf=0.9, provider="other")]),
        ChunkResult(_w(1, 15, 35), [_c("A", conf=0.85)]),
    ]
    a = reconstruct_timeline(chunks)
    b = reconstruct_timeline(chunks)
    assert [(s.start_seconds, s.end_seconds, s.state, s.title) for s in a] == [
        (s.start_seconds, s.end_seconds, s.state, s.title) for s in b
    ]
