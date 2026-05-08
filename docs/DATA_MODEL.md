# Data Model

This document defines the canonical MVP entities. Field names may evolve during
implementation, but behavior and ownership should remain stable.

## MediaAsset

Represents an uploaded local media file.

- `id`
- `originalFilename`
- `contentType`
- `storagePath`
- `checksum`
- `durationSeconds`
- `createdAt`

Supported MVP inputs are `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.mp4`, and
video containers with audio streams.

## AnalysisJob

Represents asynchronous analysis of one media asset.

- `id`
- `mediaAssetId`
- `status`: `queued`, `running`, `succeeded`, `failed`, `cancelled`
- `progress`: number from 0 to 1
- `errorCode`
- `errorMessage`
- `createdAt`
- `startedAt`
- `finishedAt`

## AudioChunk

Represents a window of preprocessed audio.

- `id`
- `mediaAssetId`
- `analysisJobId`
- `startSeconds`
- `endSeconds`
- `sampleRate`
- `channels`
- `preprocessing`

Chunks must have deterministic ordering by start time and id.

## TrackCandidate

Normalized provider output for one chunk or region.

- `id`
- `provider`
- `title`
- `artist`
- `confidence`
- `providerTrackId`
- `album`
- `artworkUrl`
- `externalUrls`
- `metadata`

`metadata` is the only place for provider-specific data.

## TimelineSegment

Provider-agnostic reconstructed timeline output.

- `id`
- `analysisJobId`
- `startSeconds`
- `endSeconds`
- `state`: `confirmed`, `likely`, `uncertain`, `unresolved`
- `confidence`
- `candidates`
- `notes`

Segments must be stable for identical inputs.

Timeline states:

- `confirmed`
- `likely`
- `uncertain`
- `unresolved`

## ManualCorrection

Represents user edits to automated output.

- `id`
- `analysisJobId`
- `timelineSegmentId`
- `action`: `confirm`, `delete`, `merge`, `split`, `replace`, `add`
- `payload`
- `createdAt`

Manual corrections should layer over generated timeline data rather than
destroying the original provider evidence.
