# ADR 0001: Provider-Agnostic Identification Architecture

## Status

Proposed

## Context

Rekord-Fox needs to identify songs inside DJ mixes, noisy recordings, and livestreams.

No single provider is reliable enough for all cases.

Potential providers include:
- ShazamAPI
- Chromaprint
- AcoustID
- Panako
- audfprint
- Olaf
- Dejavu
- future ML embedding systems

## Decision

The system will use a provider-agnostic architecture.

Each provider must implement a shared interface and return normalized candidate matches.

Provider outputs will be merged by a separate fusion engine.

Timeline reconstruction will happen after provider fusion and will remain provider-independent.

## Consequences

Benefits:
- providers can be swapped
- multiple providers can run together
- local/offline providers are supported
- future ML systems can be added
- timeline reconstruction stays clean

Tradeoffs:
- more upfront architecture
- normalized result format must be carefully designed
- provider-specific metadata needs clear boundaries