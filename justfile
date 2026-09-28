set shell := ["bash", "-cu"]

backend := "apps/backend"
web     := "apps/web"
desktop := "apps/desktop"

setup:
    @if [ ! -d {{backend}}/.venv ]; then python3 -m venv {{backend}}/.venv; fi
    {{backend}}/.venv/bin/pip install -q -e "{{backend}}[dev]"
    cd {{web}} && npm install --silent
    cd {{desktop}} && npm install --silent

dev-api:
    cd {{backend}} && .venv/bin/uvicorn rekord.api.main:app --reload --host 127.0.0.1 --port 8000

dev-web:
    cd {{web}} && npm run dev

dev:
    @echo "Run 'just dev-api' in one terminal and 'just dev-web' in another."

lint:
    cd {{backend}} && .venv/bin/ruff check src tests
    cd {{web}} && npm run lint --silent

typecheck:
    cd {{backend}} && .venv/bin/mypy src || true
    cd {{web}} && npx tsc -b

test: test-backend test-web

test-backend:
    cd {{backend}} && .venv/bin/pytest

test-web:
    cd {{web}} && npx tsc -b

check: lint typecheck test

identify FILE PROVIDER='shazam':
    cd {{backend}} && .venv/bin/python scripts/identify.py "../../{{FILE}}" --provider {{PROVIDER}}

desktop-dev:
    cd {{desktop}} && npm run dev

desktop-build:
    cd {{desktop}} && npm run build:mac

desktop-dist:
    cd {{desktop}} && npm run dist:mac
