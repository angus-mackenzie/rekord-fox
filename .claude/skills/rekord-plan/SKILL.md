---
name: rekord-plan
description: Plan one focused Rekord-Fox implementation task before edits.
---

Use this skill when asked to plan a Rekord-Fox change or before making a
multi-file change.

1. Read `README.md`, `spec/REKORD_FOX_SPEC.md`, `docs/ARCHITECTURE.md`,
   `docs/PROVIDERS.md`, and `docs/INVARIANTS.md`.
2. Inspect only the relevant modules and tests for the requested area.
3. State the goal, affected boundaries, public contract changes, tests, and
   documentation updates.
4. Keep the plan small enough for one pull request.
5. Call out any provider leakage, UI coupling, hidden state, nondeterminism, or
   missing verification surface before implementation starts.
