# Testing Strategy

Rekord-Fox needs strong tests around audio processing, provider fusion, and timeline reconstruction.

## Required Test Types

### Unit Tests

For:
- chunking
- confidence scoring
- provider normalization
- timestamp calculations
- timeline smoothing

### Integration Tests

For:
- upload to analysis flow
- provider execution
- database persistence
- API responses

### Provider Simulation Tests

Use fake providers to test:
- conflicting detections
- intermittent detections
- low-confidence matches
- overlapping tracks
- provider failure

### Regression Tests

Important for:
- false positives
- silence handling
- noisy audio
- transition regions
- duplicate detections

## Critical Systems Requiring Coverage

- provider abstraction
- multi-provider fusion
- timeline reconstruction
- confidence propagation
- chunk alignment
- manual correction state

## Determinism

Tests should avoid:
- nondeterministic ordering
- time-based randomness
- hidden global state
- provider API dependence

Mock external providers where possible.