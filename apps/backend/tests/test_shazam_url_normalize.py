"""Shazam returns native scheme URIs (`spotify:track:...`,
`spotify:search:...`) for some tracks. Those aren't navigable web URLs and
break the UI / exports. The provider must normalise them before persistence.
"""
from __future__ import annotations

from rekord.providers.shazam_provider import _extract_external_urls, _normalize_spotify


def test_normalize_spotify_passes_http_through():
    assert _normalize_spotify("https://open.spotify.com/track/abc") == "https://open.spotify.com/track/abc"
    assert _normalize_spotify("http://open.spotify.com/track/abc") == "http://open.spotify.com/track/abc"


def test_normalize_spotify_track_uri():
    assert _normalize_spotify("spotify:track:abc123") == "https://open.spotify.com/track/abc123"


def test_normalize_spotify_search_uri():
    assert (
        _normalize_spotify("spotify:search:Pacific%20Billy%20Bahama")
        == "https://open.spotify.com/search/Pacific%20Billy%20Bahama"
    )


def test_normalize_spotify_drops_unknown_schemes():
    assert _normalize_spotify("rdio:track:foo") is None
    assert _normalize_spotify("javascript:alert(1)") is None  # noqa: F841 — security smoke


def test_extract_drops_uri_when_no_web_form_available():
    """Real-world Shazam payload that triggered the original bug — the
    provider returned `spotify:search:...` and we persisted it verbatim,
    so exports surfaced a non-clickable string. The normaliser should have
    converted it; if extraction can't normalise, it must drop, not store."""
    track = {
        "url": "https://www.shazam.com/track/123",
        "hub": {
            "providers": [
                {
                    "type": "SPOTIFY",
                    "actions": [{"uri": "spotify:search:Foo%20Bar"}],
                }
            ]
        },
    }
    urls = _extract_external_urls(track)
    assert urls["spotify"] == "https://open.spotify.com/search/Foo%20Bar"
    assert urls["shazam"] == "https://www.shazam.com/track/123"


def test_extract_drops_unrecognised_apple_music_scheme():
    """Apple Music sometimes hands back `applemusic://...` deep links —
    pass http through, drop everything else."""
    track = {
        "hub": {
            "actions": [
                {"type": "applemusicplay", "uri": "applemusic://track/999"},
            ]
        },
    }
    urls = _extract_external_urls(track)
    assert "apple_music" not in urls
