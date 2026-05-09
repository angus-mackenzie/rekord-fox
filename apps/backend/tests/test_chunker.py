from rekord.audio.chunker import plan_chunks


def test_zero_duration_returns_no_chunks():
    assert plan_chunks(0.0, 20.0, 5.0) == []


def test_basic_overlap_layout():
    chunks = plan_chunks(60.0, 20.0, 5.0)
    # step = 15s; chunks at 0, 15, 30, 45 each 20s long, last clamped to 60
    starts = [c.start_seconds for c in chunks]
    ends = [c.end_seconds for c in chunks]
    assert starts == [0.0, 15.0, 30.0, 45.0]
    assert ends == [20.0, 35.0, 50.0, 60.0]


def test_indices_are_sequential():
    chunks = plan_chunks(60.0, 20.0, 5.0)
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_last_chunk_clamped_to_duration():
    chunks = plan_chunks(7.0, 20.0, 5.0)
    assert len(chunks) == 1
    assert chunks[0].start_seconds == 0.0
    assert chunks[0].end_seconds == 7.0


def test_invalid_overlap_rejected():
    import pytest

    with pytest.raises(ValueError):
        plan_chunks(60.0, 20.0, 20.0)
    with pytest.raises(ValueError):
        plan_chunks(60.0, 0.0, 0.0)


def test_deterministic_under_repeated_calls():
    a = plan_chunks(123.456, 20.0, 5.0)
    b = plan_chunks(123.456, 20.0, 5.0)
    assert a == b
