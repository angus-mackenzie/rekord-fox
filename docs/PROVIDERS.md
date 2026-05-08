# Identification Providers

Rekord-Fox supports multiple interchangeable identification providers.

The system should not depend on a single provider.

## Provider Categories

### Classical Fingerprinting

Examples:
- ShazamAPI
- Chromaprint
- AcoustID

Best for:
- clean audio
- commercially released tracks
- fast metadata lookup

Weaknesses:
- less robust to heavy transitions
- less robust to pitch/BPM shifts

### Landmark-Based Fingerprinting

Examples:
- Panako
- audfprint
- Olaf
- Dejavu

Best for:
- DJ mixes
- noisy recordings
- pitch-shifted audio
- time-stretched audio
- local fingerprint databases

Panako is a strong MVP candidate because it is designed for robustness against time stretching and pitch shifting.

### Neural / ML-Based Embeddings

Future candidates:
- neural-audio-fp
- custom embedding models
- vector similarity search

Not required for MVP.

Potential drawbacks:
- more infrastructure
- larger indexes
- possible GPU requirements

## Provider Interface

All providers should implement a shared interface.

```ts
interface FingerprintProvider {
  identify(chunk: AudioChunk): Promise<TrackMatch[]>
}
```
Providers should return normalized results containing:
```ts
interface TrackMatch {
  provider: string
  title: string
  artist: string
  confidence: number
  providerTrackId?: string
  album?: string
  artworkUrl?: string
  externalUrls?: {
    spotify?: string
    soundcloud?: string
    youtube?: string
    appleMusic?: string
  }
  metadata?: Record<string, unknown>
}
```

## Provider Rules

Providers must:

* be isolated
* return normalized results
* include confidence where possible
* include provider metadata separately
* not directly update timeline state
* not directly update frontend state

## Fusion Signals

The fusion engine may use:

* provider confidence
* repeated detections across windows
* temporal continuity
* spectral similarity
* agreement between providers
* historical provider reliability
* match stability across neighbouring chunks