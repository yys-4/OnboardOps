.PHONY: up down build logs shell-backend shell-incident migrate seed clean

# ── Lifecycle ──────────────────────────────────────────────────────────────
up:
	docker compose up -d --build
	@echo "Services up. Dashboard: http://localhost:3000"

down:
	docker compose down

build:
	docker compose build --parallel

logs:
	docker compose logs -f

restart-%:
	docker compose restart $*

# ── Dev shortcuts ──────────────────────────────────────────────────────────
shell-backend:
	docker compose exec backend sh

shell-incident:
	docker compose exec incident-manager bash

# ── Database ───────────────────────────────────────────────────────────────
migrate:
	cd services/backend && npm run migrate

migrate-rollback:
	cd services/backend && npm run migrate:rollback

seed:
	cd services/backend && npm run seed

# ── Local dev (no Docker) ──────────────────────────────────────────────────
dev-backend:
	cd services/backend && npm install && npm run dev

dev-incident:
	cd services/incident-manager && pip install -e ".[dev]" && uvicorn app.main:app --reload --port 5000

dev-dashboard:
	cd dashboard && npm install && npm run dev

# ── Quality ────────────────────────────────────────────────────────────────
lint:
	cd services/backend && npm run lint
	cd dashboard && npm run lint

test:
	cd services/backend && npm test
	cd services/incident-manager && pytest

# ── Cleanup ────────────────────────────────────────────────────────────────
clean:
	docker compose down -v
	rm -rf .data/
