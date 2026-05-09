from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="REKORD_", env_file=".env", extra="ignore")

    data_dir: Path = Path("data")
    upload_dir: Path = Path("data/uploads")
    waveform_cache_dir: Path = Path("data/waveforms")
    db_path: Path = Path("data/rekord.db")

    chunk_seconds: float = 20.0
    chunk_overlap_seconds: float = 5.0
    sample_rate: int = 16000

    provider: str = "shazam"  # "shazam" or "fake_csv"
    fake_csv_path: Path = Path("data/set79_kyle_starkey_b2b_bella_claxton.csv")

    confidence_confirmed: float = 0.85
    confidence_likely: float = 0.6
    confidence_uncertain: float = 0.3

    # Timeline fusion: appearances of the same track key within this many
    # chunks of each other are treated as one continuous play. With default
    # 20s/5s chunks (15s step), 5 chunks ≈ 75s of tolerated dropouts.
    cluster_max_gap_chunks: int = 5

    # How many chunks to fingerprint in parallel against the provider.
    # Shazam (unofficial) tolerates ~8 well; bump higher at risk of throttling.
    provider_concurrency: int = 8


settings = Settings()


def ensure_dirs() -> None:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.waveform_cache_dir.mkdir(parents=True, exist_ok=True)
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
