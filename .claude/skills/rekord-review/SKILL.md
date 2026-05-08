---
name: rekord-review
description: Review a Rekord-Fox diff for architecture, testing, and contract risks.
---

Use this skill for code review or pre-commit review.

Review findings first, ordered by severity. Focus on:

- provider-specific logic leaking into shared systems or frontend rendering
- timeline logic that depends on provider identity instead of normalized outputs
- hidden global state, nondeterministic ordering, time-based randomness, or
  tests that call external APIs
- public interface changes not reflected in docs or generated contracts
- behavior changes without focused tests
- upload, file handling, command execution, or secret exposure risks

If no issues are found, say so and list any residual test gaps.
