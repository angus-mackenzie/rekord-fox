# Claude Code Guide for Rekord-Fox

Rekord-Fox is a self-hosted web app for identifying tracks in DJ mixes, radio
shows, livestream recordings, festival captures, and noisy audio recordings.
The product should ingest media, analyse audio over time, identify candidate
tracks, reconstruct a probable timeline, and present uncertainty clearly.

This is the canonical Claude Code entrypoint. `AGENTS.md` mirrors shared rules
for other agents. When Claude-specific workflow or tool behavior matters, this
file and `.claude/` take precedence.

## Required Reading

Before changing files, read:

1. `README.md`
2. `spec/REKORD_FOX_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PROVIDERS.md`
5. Relevant files in the area being modified

Also check `docs/INVARIANTS.md` for rules that must not be violated.

## Chosen Stack

- Frontend: React, TypeScript, TailwindCSS.
- Backend API: Python, FastAPI, Pydantic.
- Worker: Python process sharing backend contracts.
- Storage: SQLite for MVP, Postgres later if needed.
- Media processing: FFmpeg first, provider modules second.
- Deployment: Docker Compose and local development mode.

## Architecture Boundaries

- Providers implement shared interfaces and return normalized matches.
- Providers must not update timeline state, frontend state, or global app state.
- Timeline reconstruction is provider-agnostic and consumes normalized outputs.
- The UI consumes normalized backend outputs and must not branch on provider names.
- Provider-specific metadata belongs in explicit metadata fields only.
- Uncertainty must be represented explicitly instead of hidden or discarded.

## Workflow

Use Plan Mode for multi-file work, architectural changes, public contract changes,
or unfamiliar areas. Use the built-in Explore agent for broad discovery. Use
project skills for Rekord-Fox-specific workflows:

- `/rekord-plan` for planning a focused implementation.
- `/rekord-implement` for one small implementation task.
- `/rekord-review` for diff review.
- `/rekord-verify` for choosing and running checks.
- `/rekord-task` for converting an idea into a task file.

Prefer small changes that can be verified quickly. Do not bundle unrelated
refactors with feature work.

## Verification Commands

Use the smallest command that proves the change:

```sh
just check
just test
just lint
just typecheck
just test-backend
just test-web
```

If the app scaffold for a command does not exist yet, the command should report
that it is skipped rather than failing for missing directories. Do not invent
new verification commands without updating this file and `.claude/settings.json`.
If `just` is not installed yet, use the bootstrap check:

```sh
bash scripts/check-claude-readiness.sh
```

## Hard Rules

Do not:

- introduce provider-specific logic into shared systems
- put provider-specific rendering logic in the frontend
- create hidden global state
- silently change public interfaces
- remove tests without replacing them
- use external provider APIs in deterministic tests
- commit local media, generated fingerprints, caches, databases, or secrets
- add hooks or broad auto-approved shell permissions without explicit approval

## Commit Style

Use conventional commits:

```text
feat: add upload job skeleton
fix: prevent false positives during silence
refactor: split provider interface
test: add timeline smoothing coverage
docs: update architecture notes
```
