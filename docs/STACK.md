# Stack

## Baseline

- Web: React, TypeScript, Vite, TailwindCSS.
- API: Python, FastAPI, Pydantic v2.
- Worker: Python, sharing API/domain contracts.
- Database: SQLite for MVP.
- Future database option: Postgres when SQLite is no longer sufficient.
- Media tooling: FFmpeg.
- Packaging: Node package manager for web, Python virtual environment or `uv`
  for backend once scaffolded.
- Local orchestration: Docker Compose plus local dev commands.
- Deployment targets: macOS, Linux, homelab servers, Docker environments, and
  ARM64 where practical.

## Repository Layout Target

```text
apps/web/             React UI
services/api/         FastAPI service
services/worker/      background analysis worker
packages/contracts/   generated or shared API contracts
docs/                 architecture and operating docs
spec/                 product specification
tasks/                scoped implementation tasks
research/             papers, prototypes, and experiments
```

## Verification Surface

The repository standardizes on `just`:

```sh
just setup
just dev
just lint
just typecheck
just test
just test-backend
just test-web
just check
```

Before the app scaffold exists, these commands may skip missing subsystems. Once
a subsystem is added, the matching command must run real checks for it.

If `just` is not installed yet, run the bootstrap readiness check directly:

```sh
bash scripts/check-claude-readiness.sh
```

## Dependency Rules

- Prefer boring, widely used dependencies.
- Add a dependency only when it removes meaningful complexity or provides a
  proven domain implementation.
- Do not introduce provider-specific dependencies into shared timeline or UI
  packages.
- Keep optional provider dependencies isolated behind provider modules.
