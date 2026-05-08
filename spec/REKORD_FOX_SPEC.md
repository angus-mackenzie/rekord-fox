# Rekord-Fox Product Spec

## MVP Goal

Rekord-Fox helps a self-hosting user identify released tracks inside a recorded
DJ mix or noisy audio capture. The MVP should accept a local media file, create
an asynchronous analysis job, run deterministic provider simulation or real
provider modules behind shared interfaces, reconstruct a normalized timeline,
and show confidence and uncertainty in the UI.

The first useful milestone is not perfect recognition. It is a reliable product
spine that can ingest media, track jobs, call providers through stable
contracts, and render a timeline without provider-specific UI assumptions.

## Product Inspiration

The product should feel like a mix of:

- Linear
- SoundCloud
- modern DJ tracklisting websites

Reference experiences:

- https://linear.app/
- https://set79.com/tracklist/soundcloud.com/intercell/kyle-starkey-b2b-bella-claxton-at-intercell-melbourne
- https://trackid.net/audiostreams/glitterbox-radio-show-469-hosted-by-melvo-baptiste

## Primary Users

- DJs checking their own recorded mixes.
- Collectors identifying tracks in downloaded mixes or radio shows.
- Self-hosters who want local-first processing and control over their media.

## In Scope for MVP

- Local upload of audio or video files with audio streams.
- Supported input formats: `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.mp4`.
- FFmpeg-based decoding and preprocessing.
- Configurable chunking, defaulting to 20 second windows with 5 second overlap.
- Provider abstraction with fake providers for deterministic tests.
- Local SQLite persistence for media, jobs, provider candidates, and timelines.
- Timeline states: `confirmed`, `likely`, `uncertain`, `unresolved`.
- A React UI for upload progress, job state, and timeline inspection.
- Manual correction concepts in the data model, even if the first UI is basic.

## Expected Accuracy

Expected to work well with:

- clear DJ mixes
- smooth transitions
- moderate BPM changes
- moderate pitch shifting
- tracks overlapping during transitions
- festival recordings with crowd noise
- livestream recordings
- car recordings
- pocket or phone recordings with reasonable clarity

Expected degradation:

- heavy distortion
- layered mashups
- stem-only edits
- multiple simultaneous tracks
- extremely clipped audio
- acapella overlays
- highly filtered transitions

## Out of Scope for MVP

- GPU requirements.
- Live microphone input.
- Livestream, YouTube, or SoundCloud URL ingestion.
- Collaborative editing.
- Crowd-sourced fingerprint databases.
- Neural embedding search as a required dependency.
- Perfect detection through heavy mashups, stem-only edits, or severe clipping.

## Success Criteria

- A user can run the app locally with documented commands.
- A user can upload a supported media file and receive a persistent analysis job.
- The system can produce a normalized timeline from deterministic fake-provider
  output without external network calls.
- Provider modules can be added without changing frontend rendering logic.
- Timeline reconstruction remains deterministic for the same provider outputs.
- The UI displays uncertain regions and multiple candidates clearly.

## Quality Priorities

1. Precision over recall.
2. Avoid false positives.
3. Preserve confidence and uncertainty.
4. Keep provider logic isolated.
5. Keep tests deterministic and local.
6. Prefer small, replaceable modules over monolithic recognition logic.
