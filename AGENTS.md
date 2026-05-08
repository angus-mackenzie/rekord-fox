# Agent Instructions

This repository is designed to be developed with both humans and AI coding agents.

Claude Code users must read `CLAUDE.md` first. Claude-specific workflows,
skills, settings, and subagents live under `.claude/`. `AGENTS.md` remains the
shared baseline for all coding agents.

Agents must prioritize:
- small incremental changes
- clear interfaces
- strong typing
- deterministic behaviour
- modularity
- tests with behaviour changes
- documentation updates with architectural changes

## Before Making Changes

Agents must read:

1. `README.md`
2. `spec/REKORD_FOX_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PROVIDERS.md`
5. Relevant files in the area being modified

## Hard Rules

Do not:
- rewrite large parts of the system without instruction
- introduce provider-specific logic into shared systems
- put provider-specific rendering logic in the frontend
- create hidden global state
- mix unrelated refactors with feature work
- remove tests without replacing them
- silently change public interfaces

## Architecture Boundaries

Providers must:
- implement shared interfaces
- be isolated modules
- avoid direct UI dependencies
- avoid owning global application state

The timeline engine must:
- be provider-agnostic
- consume normalized provider outputs
- produce stable timeline results

The UI must:
- consume normalized backend outputs
- avoid provider-specific assumptions
- display uncertainty clearly

## Expected Workflow

For any task:

1. Understand the relevant docs
2. Identify affected modules
3. Make the smallest useful change
4. Add or update tests
5. Update documentation if behaviour or architecture changes
6. Summarize tradeoffs clearly

## Commit Style

Use conventional commits:

```text
feat: add panako provider
fix: improve transition smoothing
refactor: extract provider interface
test: add provider fusion tests
docs: update architecture notes
