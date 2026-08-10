.PHONY: setup dev api web seed test test-backend test-frontend check build e2e verify

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

check:
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
