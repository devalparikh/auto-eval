.PHONY: setup dev api web seed test test-backend test-frontend check build e2e verify api-types api-types-check

setup:
	python3 -m venv .venv
	.venv/bin/python -m pip install --upgrade pip
	.venv/bin/python -m pip install -e 'backend[dev]'
	cd frontend && npm install

dev:
	./scripts/dev.sh

api:
	.venv/bin/uvicorn autoeval_api.main:app --app-dir backend/src --reload --port 8000

web:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	.venv/bin/pytest backend/tests

test-frontend:
	cd frontend && npm run test:run

api-types:
	cd frontend && npm run generate:api-types

# Fails when frontend/openapi.json or src/lib/api-schema.ts are stale relative
# to the backend. src/lib/api-contract.ts then makes `npm run typecheck` fail
# when the hand-written types in src/lib/types.ts drift from that schema.
api-types-check:
	@set -e; tmp=$$(mktemp -d); trap 'rm -rf $$tmp' EXIT; \
	.venv/bin/python scripts/export_openapi.py --output $$tmp/openapi.json >/dev/null; \
	(cd frontend && npx --no-install openapi-typescript $$tmp/openapi.json -o $$tmp/api-schema.ts >/dev/null); \
	diff -u frontend/openapi.json $$tmp/openapi.json || { echo "frontend/openapi.json is stale - run 'make api-types'"; exit 1; }; \
	diff -u frontend/src/lib/api-schema.ts $$tmp/api-schema.ts || { echo "frontend/src/lib/api-schema.ts is stale - run 'make api-types'"; exit 1; }; \
	echo "API types are in sync with the backend schema"

check: api-types-check
	.venv/bin/ruff check backend/src backend/tests
	.venv/bin/ruff format --check backend/src backend/tests
	.venv/bin/pytest backend/tests
	cd frontend && npm run lint && npm run typecheck && npm run test:run

build:
	cd frontend && npm run build

e2e:
	cd frontend && npm run test:e2e

verify: check build e2e

seed:
	.venv/bin/python -m autoeval_api.seed
