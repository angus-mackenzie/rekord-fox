# API Contract

The API is REST-first for the MVP. WebSocket or server-sent progress updates may
be added later, but polling job state is enough for the first implementation.

## Type Policy

- Backend request and response models are canonical.
- Frontend types must be generated from OpenAPI or imported from a shared
  contract package.
- Public response fields must not change silently.
- Provider-specific fields are allowed only under explicit metadata objects.

## Core Routes

```text
POST   /api/media
GET    /api/media/{mediaId}
POST   /api/analysis-jobs
GET    /api/analysis-jobs/{jobId}
POST   /api/analysis-jobs/{jobId}/cancel
GET    /api/analysis-jobs/{jobId}/timeline
```

## Media Upload

`POST /api/media` accepts one supported media file and returns `MediaAsset`.

Validation:

- reject unsupported extensions or MIME types
- enforce configured file size limits
- store original filename separately from storage path
- compute a checksum for duplicate detection and reproducibility

## Analysis Jobs

`POST /api/analysis-jobs` creates an asynchronous job for a media asset.

The request may include provider selection and chunking options. If omitted, the
system uses configured defaults.

Job status values:

```text
queued
running
succeeded
failed
cancelled
```

Large files should process asynchronously. Job handling should support upload
progress, analysis progress, retries, cancellation, resumable work where
practical, and queue visibility.

## Timeline

`GET /api/analysis-jobs/{jobId}/timeline` returns normalized timeline segments.
Each segment includes a state, confidence, timestamp range, and zero or more
candidate tracks. The frontend must be able to render the response without
knowing which provider produced a candidate.

REST is the MVP API style. Live progress updates may later use WebSockets or
server-sent events. GraphQL is a possible future option, not an MVP requirement.

## Errors

Errors should be structured and stable:

```json
{
  "error": {
    "code": "unsupported_media_type",
    "message": "The uploaded file type is not supported."
  }
}
```

Do not expose local filesystem paths, credentials, or provider secrets in API
errors.
