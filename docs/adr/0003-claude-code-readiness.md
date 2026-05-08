# ADR 0003: Claude Code as Primary Agent Workflow

## Status

Accepted

## Context

Rekord-Fox is intended to be developed with AI coding agents. Claude Code is the
primary target tool, and it performs best when repository memory, permissions,
verification commands, reusable skills, and focused subagents are explicit.

## Decision

Add `CLAUDE.md` as the canonical Claude Code memory file. Keep `.claude/`
project settings, skills, and subagents in source control. Keep `AGENTS.md` as
the shared baseline for other agents.

## Consequences

Benefits:

- new Claude sessions start with project-specific context
- repeated workflows become skills instead of long prompts
- subagents can review provider, timeline, audio, frontend, and test concerns
- permissions can block secrets and local media artifacts

Tradeoffs:

- Claude-specific files must be maintained with architecture docs
- verification commands must stay accurate as the scaffold evolves
- overly broad permissions would be risky, so commands are intentionally exact
