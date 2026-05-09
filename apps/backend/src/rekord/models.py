import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship, SQLModel


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    paused = "paused"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class SegmentState(StrEnum):
    confirmed = "confirmed"
    likely = "likely"
    uncertain = "uncertain"
    unresolved = "unresolved"


class MediaAsset(SQLModel, table=True):
    __tablename__ = "media_assets"

    id: str = Field(default_factory=_uuid, primary_key=True)
    original_filename: str
    content_type: str
    storage_path: str
    checksum: str
    duration_seconds: float | None = None
    created_at: datetime = Field(default_factory=_now)

    jobs: list["AnalysisJob"] = Relationship(back_populates="media")


class AnalysisJob(SQLModel, table=True):
    __tablename__ = "analysis_jobs"

    id: str = Field(default_factory=_uuid, primary_key=True)
    media_asset_id: str = Field(foreign_key="media_assets.id", index=True)
    status: JobStatus = Field(default=JobStatus.queued)
    progress: float = 0.0
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime = Field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    media: MediaAsset | None = Relationship(back_populates="jobs")
    segments: list["TimelineSegment"] = Relationship(back_populates="job")
    candidates: list["TrackCandidate"] = Relationship(back_populates="job")


class TrackCandidate(SQLModel, table=True):
    """A normalized provider match for a specific chunk."""

    __tablename__ = "track_candidates"

    id: str = Field(default_factory=_uuid, primary_key=True)
    analysis_job_id: str = Field(foreign_key="analysis_jobs.id", index=True)
    provider: str
    chunk_start_seconds: float
    chunk_end_seconds: float
    title: str
    artist: str
    confidence: float
    provider_track_id: str | None = None
    album: str | None = None
    artwork_url: str | None = None
    external_urls: dict[str, str] = Field(default_factory=dict, sa_column=Column(JSON))
    candidate_metadata: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    job: AnalysisJob | None = Relationship(back_populates="candidates")


class TimelineSegment(SQLModel, table=True):
    __tablename__ = "timeline_segments"

    id: str = Field(default_factory=_uuid, primary_key=True)
    analysis_job_id: str = Field(foreign_key="analysis_jobs.id", index=True)
    start_seconds: float
    end_seconds: float
    state: SegmentState
    confidence: float
    title: str | None = None
    artist: str | None = None
    # Snapshot of supporting candidates: list of dicts (provider, title, artist, confidence,
    # external_urls, etc.) — preserves competing evidence even after fusion picks a primary.
    candidates: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    notes: str | None = None

    job: AnalysisJob | None = Relationship(back_populates="segments")


class ChunkAttempt(SQLModel, table=True):
    """Records that a (start, end) window has been attempted for a job.

    The presence of a row means "we have already asked the provider about this
    window" — regardless of whether the provider returned a match. This lets
    pause/resume skip windows that were already processed and avoids paying
    for the same Shazam call twice across a server restart.
    """

    __tablename__ = "chunk_attempts"

    id: str = Field(default_factory=_uuid, primary_key=True)
    analysis_job_id: str = Field(foreign_key="analysis_jobs.id", index=True)
    start_seconds: float
    end_seconds: float
    completed_at: datetime = Field(default_factory=_now)
