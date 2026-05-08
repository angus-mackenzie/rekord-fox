# Development Workflow

## Recommended Workflow

1. Pick one focused task
2. Read the relevant docs
3. Identify affected modules
4. Make a small change
5. Add or update tests
6. Run checks
7. Update docs if needed
8. Commit using conventional commits

## Local Development

Preferred setup:
- Docker Compose for services
- local frontend dev server
- local backend API
- local SQLite database for MVP

## Task Size

Prefer small tasks.

Good:
- add provider interface
- add chunking utility
- add upload skeleton
- add timeline smoothing test

Bad:
- build entire backend
- rewrite provider system
- implement all providers at once

## Experimental Work

Experimental code should live in:

```text
/research
/prototypes
/experimental
```

Do not couple experiments directly into production code until stabilized.

## Architectural Decisions

Use ADRs for major decisions.

Examples:

* choosing FastAPI vs Node
* choosing SQLite vs Postgres
* choosing Panako as MVP provider
* changing provider interfaces