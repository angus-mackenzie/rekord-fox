#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "CLAUDE.md"
  "AGENTS.md"
  ".claude/settings.json"
  ".claude/skills/rekord-plan/SKILL.md"
  ".claude/skills/rekord-implement/SKILL.md"
  ".claude/skills/rekord-review/SKILL.md"
  ".claude/skills/rekord-verify/SKILL.md"
  ".claude/skills/rekord-task/SKILL.md"
  ".claude/agents/provider-architect.md"
  ".claude/agents/timeline-engine-reviewer.md"
  ".claude/agents/audio-pipeline-researcher.md"
  ".claude/agents/frontend-ux-reviewer.md"
  ".claude/agents/test-strategist.md"
  "spec/REKORD_FOX_SPEC.md"
  "docs/ARCHITECTURE.md"
  "docs/STACK.md"
  "docs/API.md"
  "docs/DATA_MODEL.md"
  "docs/INVARIANTS.md"
  "docs/PROVIDERS.md"
  "docs/TESTING.md"
  "tasks/TASK_TEMPLATE.md"
)

for file in "${required_files[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "Missing or empty required file: $file" >&2
    exit 1
  fi
done

python3 -m json.tool .claude/settings.json >/dev/null

grep -q "CLAUDE.md" AGENTS.md
grep -q "Claude Code Guide" CLAUDE.md
grep -q "Bash(just check)" .claude/settings.json
grep -q "Read(./.env)" .claude/settings.json

echo "Claude readiness checks passed."
