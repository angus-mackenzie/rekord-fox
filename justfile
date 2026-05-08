set shell := ["bash", "-cu"]

setup:
    @echo "No application scaffold exists yet. Install toolchains when apps/web and services/api are added."

dev:
    @echo "No application scaffold exists yet. Add apps/web, services/api, and services/worker before starting dev servers."

lint:
    @bash scripts/check-claude-readiness.sh

typecheck:
    @echo "No TypeScript or Python application scaffold exists yet. Typecheck skipped."

test:
    @bash scripts/check-claude-readiness.sh

test-backend:
    @echo "No backend scaffold exists yet. Backend tests skipped."

test-web:
    @echo "No web scaffold exists yet. Web tests skipped."

check:
    @bash scripts/check-claude-readiness.sh
    @just typecheck
    @just test-backend
    @just test-web
