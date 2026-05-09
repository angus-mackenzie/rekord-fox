from __future__ import annotations

from ..config import settings
from .base import Provider


def get_provider(name: str | None = None) -> Provider:
    name = name or settings.provider
    if name == "shazam":
        from .shazam_provider import ShazamProvider

        return ShazamProvider()
    if name == "fake_csv":
        from .fake_csv import FakeCsvProvider

        return FakeCsvProvider(settings.fake_csv_path)
    raise ValueError(f"unknown provider: {name}")
