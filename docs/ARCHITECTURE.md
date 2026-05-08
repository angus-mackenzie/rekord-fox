# Architecture

Rekord-Fox is a modular audio-identification pipeline with a web UI, API,
background worker, provider modules, and a provider-agnostic timeline engine.

## System Shape

```text
media upload
  -> API persistence
  -> analysis job
  -> worker
  -> FFmpeg preprocessing
  -> chunking
  -> provider queries
  -> normalized candidates
  -> fusion and timeline reconstruction
  -> API response
  -> UI timeline
```

## Frontend

- React, TypeScript, and TailwindCSS.
- Consumes generated API types or a checked contract package.
- Displays normalized media, job, candidate, and timeline data.
- Shows confidence, uncertainty, overlap, and unresolved regions explicitly.
- Must not branch on provider names for rendering behavior.

## Backend API

- Python FastAPI service.
- Owns HTTP contracts, validation, persistence access, and job creation.
- Does not run long audio analysis inside request handlers.
- Exposes media, analysis job, timeline, and manual correction endpoints.

## Worker

- Python worker process using the same core contracts as the API.
- Runs FFmpeg preprocessing, chunking, provider calls, fusion, and timeline
  reconstruction.
- Persists intermediate and final state so jobs can be retried or inspected.
- Must emit deterministic results when provider outputs are deterministic.

## Audio Pipeline

Default preprocessing steps:

1. FFmpeg decoding
2. mono conversion
3. resampling
4. loudness normalization
5. silence trimming
6. optional denoising
7. optional band-pass filtering
8. chunking into overlapping windows

Default chunking uses 20 second windows with 5 second overlap. Window and
overlap values must be configurable.

## Providers

- Providers are isolated modules behind a shared interface.
- Providers return normalized `TrackCandidate` values.
- Provider-specific fields live only in a metadata object.
- Providers do not call UI code, mutate timeline state, or own global state.

## Timeline Engine

- Consumes normalized candidates and chunk metadata.
- Produces stable `TimelineSegment` values.
- Merges adjacent detections, smooths intermittent detections, preserves
  competing candidates, and marks uncertainty explicitly.
- Does not know how individual providers render or query results.

Timeline reconstruction should estimate probable start and end timestamps, infer
transition regions, allow overlapping candidate tracks, and support unresolved
regions when evidence is weak.

## Storage

- SQLite is the MVP database.
- Store uploaded media metadata, jobs, candidate detections, timeline segments,
  and manual corrections.
- Store large media and generated artifacts on disk, outside git.

## Deployment

- Docker Compose is the primary self-hosting path.
- Local development mode should run web, API, worker, and storage with one
  documented command once the app scaffold exists.
- The system must not require a GPU.
- macOS, Linux, homelab servers, Docker environments, and ARM64 machines are
  target deployment environments.
