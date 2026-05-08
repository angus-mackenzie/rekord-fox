# Contributing

## Development Philosophy

Rekord-Fox should remain:
- modular
- local-first
- self-hostable
- provider-independent
- testable
- easy to reason about

Avoid large, clever, tightly coupled systems.

Prefer explicit interfaces and boring reliable code.

## Branch Naming

Use short-lived branches:

```text
feature/provider-panako
feature/waveform-ui
feature/timeline-smoothing
fix/chunk-overlap
refactor/provider-interface
docs/update-spec
```

## Pull Request Requirements

Every PR should include:

* what changed
* why it changed
* affected modules
* screenshots for UI changes
* tests added or updated
* known limitations
* follow-up tasks

## Commit Conventions

Use conventional commits:
```
feat: add local fingerprint corpus
fix: prevent false positives during silence
refactor: split provider interface
perf: cache chunk fingerprints
docs: add provider architecture notes
test: add timeline smoothing coverage
```

## Code Quality

Required:

* TypeScript strict mode where possible
* typed provider interfaces
* tests for core logic
* deterministic outputs where possible
* no hidden coupling between providers

## Refactoring Rules

Refactors should:

* be isolated
* preserve behaviour
* include tests where possible
* not be bundled with unrelated features

## Documentation

Update docs when changing:

* architecture
* provider interfaces
* timeline reconstruction logic
* API contracts
* deployment assumptions