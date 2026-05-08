---
name: rekord-verify
description: Choose and run the smallest useful Rekord-Fox verification commands.
---

Use this skill when asked to verify changes or when finishing implementation.

1. Choose the smallest command that covers the changed surface:
   `just typecheck`, `just lint`, `just test-backend`, `just test-web`,
   `just test`, or `just check`.
2. Prefer targeted checks over the full suite when the changed surface is narrow.
3. If a command is skipped because the app scaffold does not exist yet, report
   the skip clearly.
4. If a command fails, summarize the root cause and fix it rather than
   suppressing the failure.
5. Do not use external provider APIs for deterministic verification.
