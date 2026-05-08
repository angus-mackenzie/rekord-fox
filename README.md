# Rekord-Fox

## Overview

Rekord-Fox is a self-hosted web application for identifying songs within DJ mixes, radio shows, livestreams, festival recordings, and noisy audio captures.

The goal is to eliminate the manual workflow of listening to a mix and repeatedly using Shazam to identify tracks.

The system should ingest a media file, analyse the audio over time, identify songs present within the recording, reconstruct a probable track timeline, and present the results in a interactive UI.

The product should feel like a mix between:

* Linear
* SoundCloud
* Modern DJ tracklisting websites

Inspirations:

* https://linear.app/
* https://set79.com/tracklist/soundcloud.com/intercell/kyle-starkey-b2b-bella-claxton-at-intercell-melbourne
* https://trackid.net/audiostreams/glitterbox-radio-show-469-hosted-by-melvo-baptiste

⸻

## Primary Goal

Identify released songs within:

* DJ mixes
* Radio shows
* Festival recordings
* Livestreams
* Mobile phone recordings
* Noisy environmental captures

The system should work even when:

* BPM is shifted
* Pitch is shifted
* Tracks overlap during transitions
* Audio contains moderate crowd noise
* Audio quality is imperfect

The system should prioritize:

1. Precision over recall
2. Avoiding false positives
3. Returning confidence scores
4. Presenting multiple candidates when uncertain


## Expected Accuracy

Expected to work well with:

* Clear DJ mixes
* Smooth transitions
* Moderate BPM changes
* Moderate pitch shifting
* Festival recordings with crowd noise
* Livestream recordings
* Car recordings
* Pocket recordings with reasonable clarity

Expected degradation:

* Heavy distortion
* Layered mashups
* Stem-only edits
* Multiple simultaneous tracks
* Extremely clipped audio
* Acapella overlays
* Highly filtered transitions

⸻

## Core Concept

The application should function as a modular audio-identification pipeline rather than a monolithic recognizer.

The pipeline should consist of independently replaceable components:

1. Media ingestion
2. Audio preprocessing
3. Chunking/windowing
4. Fingerprinting
5. Provider querying
6. Confidence scoring
7. Timeline reconstruction
8. UI rendering

Each layer should be swappable without rewriting the entire system.

⸻

## Architecture

### Frontend

* TypeScript
* React preferred
* TailwindCSS preferred
* Modern, highly polished UI
* Inspired heavily by Linear.app

### Backend

Backend framework is flexible.

Possible options:

* Node.js / TypeScript
* Python
* Rust
* Hybrid architecture

The implementation should prioritize:

* Reliability
* Audio processing performance
* Extensibility
* Easy local deployment

⸻

## Deployment Targets

The application should be easy to self-host on:

* macOS
* Linux
* Homelab servers
* Docker environments

Preferred deployment methods:

* Docker Compose
* Local development mode
* ARM64 support preferred

The system should not require GPUs.

⸻

## Media Support

Supported Inputs

* .mp3
* .wav
* .flac
* .m4a
* .aac
* .mp4
* video containers with audio streams

Potential Future Support

* Livestream URLs
* YouTube URLs
* SoundCloud URLs
* Microphone/live input

⸻

## Audio Processing Pipeline

The backend should preprocess all audio before fingerprinting.

Suggested preprocessing steps:

1. FFmpeg decoding
2. Mono conversion
3. Resampling
4. Loudness normalization
5. Silence trimming
6. Optional denoising
7. Optional band-pass filtering
8. Chunking into overlapping windows

Default chunking strategy:

* 20 second windows
* 5 second overlap
* Configurable

⸻

## Song Identification System

The system should support multiple interchangeable identification providers and fingerprinting engines.

The architecture should distinguish between:

* Classical fingerprinting providers
* Robust landmark-based fingerprinting
* Local/offline fingerprint databases
* Neural embedding systems
* Mix reconstruction systems

The implementation should NOT tightly couple itself to a single provider.

The provider system should support:

* local databases
* remote APIs
* hybrid providers
* multiple providers simultaneously
* provider weighting
* provider failover
* offline-first operation where possible

⸻

## Supported / Planned Providers

Classical Fingerprinting

These are useful for identifying commercially released tracks quickly and accurately.

Examples:

* ShazamAPI
* Chromaprint
* AcoustID

Strengths:

* Fast
* Accurate for clean audio
* Good metadata resolution

Weaknesses:

* Less robust during heavy DJ transitions
* Less robust to BPM/pitch shifting

⸻

Landmark-Based Fingerprinting

These providers are more robust for real-world DJ mixes and noisy recordings.

Examples:

* Panako
* audfprint
* Olaf
* Dejavu

Strengths:

* Better tolerance to:
    * BPM shifts
    * pitch shifts
    * noisy environments
    * crowd noise
    * stretched audio
* Better suited for:
    * DJ mixes
    * livestreams
    * festival recordings

Panako should be considered a primary candidate for the MVP backend due to its robustness to time stretching and pitch shifting.

⸻

Neural / ML-Based Embedding Systems (Future)

Potential future support:

* neural-audio-fp
* custom embedding models
* vector similarity search systems

Potential strengths:

* Better robustness to degraded recordings
* Better generalized similarity matching
* Improved handling of noisy environments

Tradeoffs:

* Higher infrastructure complexity
* Potential GPU requirements
* Larger storage/indexing requirements

Neural systems should be considered optional future enhancements rather than MVP requirements.

⸻

## Provider Abstraction Layer

All providers should implement a shared interface.

Example:
```
interface FingerprintProvider {
  identify(chunk: AudioChunk): Promise<TrackMatch[]>
}
```
This abstraction should support:

* provider swapping
* multi-provider analysis
* local/offline identification
* remote API providers
* fallback systems
* future ML integrations

Providers should operate independently and return:

* candidate matches
* confidence scores
* timing metadata
* provider-specific metadata

⸻

## Multi-Provider Fusion

Results from multiple providers should be merged using weighted confidence scoring and temporal reconstruction.

Signals may include:

1. Provider confidence
2. Repeated detections across windows
3. Temporal continuity
4. Spectral similarity
5. Agreement between providers
6. Confidence decay over time
7. Match stability across neighbouring chunks
8. Historical provider reliability

The system should favour:

* stable detections
* repeated confirmations
* temporally consistent matches
* cross-provider agreement

The system should avoid:

* noisy intermittent detections
* rapid false switching between tracks
* isolated low-confidence matches

⸻

## Mix Reconstruction & Temporal Alignment

The core differentiator of the system is not only identifying chunks of audio, but reconstructing a coherent timeline of tracks across an entire mix.

The backend should:

* smooth detections over time
* infer probable transitions
* identify dominant tracks
* support uncertain regions
* tolerate overlapping transitions

Potential future implementations may explore:

* subsequence alignment
* temporal graph reconstruction
* mix-to-track alignment systems
* DJ mix segmentation research
* probabilistic timeline inference

The system should conceptually operate as:

audio chunks
→ provider candidates
→ confidence fusion
→ temporal reconstruction
→ track timeline
→ interactive UI

⸻

## Timeline Reconstruction

The backend should reconstruct a probable track timeline from chunk-level detections.

Requirements:

1. Merge adjacent identical detections
2. Smooth noisy intermittent detections
3. Estimate probable start timestamps
4. Estimate probable end timestamps
5. Infer transitions
6. Allow overlapping candidate tracks
7. Support uncertain regions

Track states:

* Confirmed
* Likely
* Uncertain
* Unresolved

⸻

## Local Fingerprint Corpus

The system should support building and querying a local fingerprint corpus.

Potential use cases:

* private music libraries
* unreleased tracks
* Rekordbox collections
* Bandcamp downloads
* offline festival use
* local-only identification

The local corpus should support:

* incremental indexing
* re-indexing
* fingerprint caching
* duplicate detection
* provider-specific indexes

⸻

## UI / UX

The UI should feel:

* clean
* dark
* premium
* minimal
* modern
* fast
* audio-native

Strong inspiration from:

* Linear
* SoundCloud
* DJ software
* Audio mastering tools
* Teenage Engineering

⸻

## Main UI Features

Upload Flow

* Drag-and-drop upload (or selecting file natively)
* Progress indicators
* Background processing
* Job queue visibility

Waveform View

* Interactive waveform
* Zooming
* Scrubbing
* Hover previews
* Playback synchronization

Timeline View

* Identified tracks shown visually on timeline
* Confidence overlays
* Transition regions
* Overlapping candidates
* Uncertain regions

Track Cards

Each identified track should show:

* Song title
* Artist
* Album artwork (if available)
* Confidence score
* Timestamp range
* Provider source(s)

External links:

* Spotify (highest priority)
* SoundCloud
* YouTube

⸻

Manual Correction Tools

Users should be able to:

* Delete false positives
* Merge detections
* Correct tracks manually
* Lock confirmed IDs
* Add missing IDs
* Override confidence results

The system should assume imperfect automated detection.

⸻

## Storage

The system should support:

* Local fingerprint database
* Cached previous detections
* Persistent analysis jobs
* Analysis history
* SQLite for MVP
* Postgres support later

⸻

## Background Jobs

Large files should process asynchronously.

Requirements:

* Upload progress
* Analysis progress
* Resumable jobs
* Retry handling
* Job cancellation
* Worker queues

⸻

## API Design

The backend should expose:

* REST API
* Optional WebSocket updates for live progress

Potential future GraphQL support.

⸻

Future Features

Potential future roadmap:

* Spotify playlist generation
* Collaborative correction
* Crowd-sourced fingerprinting
* Custom local fingerprint corpus
* ML embedding search
* Automatic setlist generation
* BPM/key transition visualisation
* DJ transition analysis
* Vector database support
* Track recommendation systems

⸻

Technical Philosophy

The system should prioritize:

* modularity
* extensibility
* provider independence
* offline capability
* local-first workflows
* self-hosting
* resilient identification
* robust temporal reconstruction
* modern UX
* high-quality audio tooling

The architecture should feel production-ready and professional rather than academic or experimental.