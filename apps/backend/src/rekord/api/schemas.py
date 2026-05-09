from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from ..models import JobStatus, SegmentState


class MediaOut(BaseModel):
    id: str
    original_filename: str
    content_type: str
    duration_seconds: float | None
    created_at: datetime


class JobOut(BaseModel):
    id: str
    media_asset_id: str
    status: JobStatus
    progress: float
    error_code: str | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class SegmentOut(BaseModel):
    id: str
    start_seconds: float
    end_seconds: float
    state: SegmentState
    confidence: float
    title: str | None
    artist: str | None
    candidates: list[dict[str, Any]]
    notes: str | None


class ManualTagCreate(BaseModel):
    """Inbound payload for POST /jobs/{id}/manual-tags."""

    start_seconds: float
    end_seconds: float
    title: str | None = None
    artist: str | None = None
    notes: str | None = None
    external_urls: dict[str, str] = {}


class ManualTagOut(BaseModel):
    id: str
    analysis_job_id: str
    action: str
    start_seconds: float
    end_seconds: float
    title: str | None
    artist: str | None
    notes: str | None
    external_urls: dict[str, str]
    created_at: datetime


class TimelineOut(BaseModel):
    job: JobOut
    media: MediaOut
    segments: list[SegmentOut]
    # Manual user-authored tags overlay the auto-detected segments. They live
    # in their own list (not merged) so the UI can render them with distinct
    # styling and the timeline-fusion engine never has to know about them.
    manual_tags: list[ManualTagOut] = []
    candidate_count: int = 0
