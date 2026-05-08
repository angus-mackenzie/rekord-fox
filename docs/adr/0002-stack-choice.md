# ADR 0002: TypeScript Frontend and Python Backend

## Status

Proposed

## Context

Rekord-Fox needs a polished web UI, robust audio processing, provider
experimentation, and easy self-hosting. The frontend benefits from the
TypeScript and React ecosystem. The backend benefits from Python audio, ML, and
scientific tooling.

## Decision

Use React, TypeScript, and TailwindCSS for the frontend. Use Python, FastAPI,
and Pydantic for the API and worker. Use SQLite for MVP persistence.

## Consequences

Benefits:

- strong frontend typing and modern UI tooling
- direct access to Python audio and research ecosystems
- simple deployment with Docker Compose
- clear API boundary between UI and analysis services

Tradeoffs:

- two language toolchains
- generated or shared contracts are required to avoid API drift
- cross-service checks must be automated early
