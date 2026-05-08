# Invariants

These rules must hold across implementations.

## Provider Boundaries

- Providers implement shared interfaces.
- Providers return normalized candidate data.
- Provider-specific fields stay inside metadata.
- Providers do not mutate timeline state.
- Providers do not call frontend code.
- Shared systems do not branch on provider names except for configuration,
  weighting, observability, or metadata display.

## Timeline Behavior

- Timeline reconstruction is provider-agnostic.
- Identical normalized inputs produce identical timeline outputs.
- Timestamp ranges are explicit and use seconds.
- Uncertainty is represented explicitly.
- Low-confidence and conflicting detections are preserved or marked uncertain,
  not silently promoted.
- Sorting is deterministic.

## UI Behavior

- The UI consumes normalized API responses.
- The UI must display confidence and uncertainty clearly.
- The UI must not require provider-specific rendering logic.
- Manual corrections must be visible as user-authored changes.
- External music links may be displayed, with Spotify as the highest-priority
  link when available, followed by SoundCloud and YouTube.

## Testing

- Tests must not depend on live external provider APIs.
- Provider and timeline tests should use fake providers and fixtures.
- Time, randomness, and ordering must be controlled.
- Behavior changes require tests unless the change is documentation-only.

## Local-First and Self-Hosting

- The MVP must not require a GPU.
- Local media, generated fingerprints, databases, caches, and secrets stay out
  of git.
- Docker Compose and local development must remain first-class deployment paths.
