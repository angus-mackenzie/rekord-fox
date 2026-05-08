# Rekord-Fox

Rekord-Fox is a self-hosted web app for identifying tracks inside DJ mixes,
radio shows, livestream recordings, festival captures, and noisy audio files.

The goal is to replace the manual workflow of listening through a mix and
repeatedly using Shazam. Rekord-Fox should ingest a media file, analyse it over
time, identify candidate tracks, reconstruct a probable track timeline, and
present confidence and uncertainty in a polished audio-native UI.

## Current Status

This repository is in foundation mode. The product, architecture, provider
boundaries, data model, and Claude Code workflow are being made explicit before
the application scaffold is built.

The first useful milestone is:

1. upload a supported audio or video file
2. create a persistent analysis job
3. run deterministic provider simulation through the provider interface
4. reconstruct a normalized timeline
5. render that timeline in the UI without provider-specific assumptions

## Product Direction

Rekord-Fox is designed for:

- DJs checking their own recorded mixes
- collectors identifying tracks in downloaded mixes or radio shows
- self-hosters who want local-first processing
- noisy recordings where confidence and uncertainty matter

The system prioritizes precision over recall. It should avoid false positives,
return confidence scores, and show multiple candidates when uncertain.

Expected inputs include `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.mp4`, and
video containers with audio streams.

## Architecture

Rekord-Fox is a modular audio-identification pipeline:

```text
media upload
  -> preprocessing
  -> chunking
  -> provider queries
  -> normalized candidates
  -> timeline reconstruction
  -> interactive UI
```

Core rules:

- providers are isolated behind shared interfaces
- provider output is normalized before fusion or timeline reconstruction
- timeline logic is provider-agnostic
- the frontend consumes normalized backend outputs
- uncertainty is shown clearly instead of hidden

## Stack

Planned MVP stack:

- React, TypeScript, Vite, and TailwindCSS for the web UI
- Python, FastAPI, and Pydantic for the API
- Python worker process for audio analysis jobs
- SQLite for MVP persistence
- FFmpeg for media decoding and preprocessing
- Docker Compose for self-hosting

## Development

This repo standardizes on `just` for local commands:

```sh
just setup
just dev
just check
just test
just lint
just typecheck
```

The app scaffold does not exist yet, so some commands intentionally skip missing
subsystems. Until `just` is installed, run the bootstrap readiness check:

```sh
bash scripts/check-claude-readiness.sh
```

## Claude Code

Claude Code is the primary agentic development workflow for this repo.

- Start with `CLAUDE.md`.
- Shared Claude settings live in `.claude/settings.json`.
- Project skills live in `.claude/skills/`.
- Project subagents live in `.claude/agents/`.
- Cross-agent rules remain in `AGENTS.md`.

Claude should make small changes, preserve architecture boundaries, add tests
for behavior changes, and run the smallest useful verification command.

## Documentation Map

- `spec/REKORD_FOX_SPEC.md` - MVP scope, non-goals, and success criteria
- `docs/ARCHITECTURE.md` - system boundaries and data flow
- `docs/STACK.md` - chosen stack and repository layout
- `docs/PROVIDERS.md` - provider categories and provider interface rules
- `docs/API.md` - REST API contract and type policy
- `docs/DATA_MODEL.md` - canonical entities and state transitions
- `docs/INVARIANTS.md` - rules implementations must not violate
- `docs/TESTING.md` - deterministic testing strategy
- `docs/DEVELOPMENT_WORKFLOW.md` - contribution workflow
- `docs/adr/` - architecture decision records

## Design Direction

The UI should feel clean, dark, fast, and audio-native, with inspiration from
Linear, SoundCloud, DJ software, audio mastering tools, and modern tracklisting
sites.

Important UI surfaces:

- upload flow with progress
- background analysis job visibility
- waveform and timeline inspection
- confidence overlays and uncertain regions
- track cards with metadata and external links
- manual correction tools for false positives and missing IDs

## Future Ideas

- Panako or other robust local fingerprint providers
- local fingerprint corpus for private music libraries
- Spotify playlist generation
- collaborative correction
- livestream URL ingestion
- ML embedding search
- BPM/key transition visualisation
- DJ transition analysis
