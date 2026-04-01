.PHONY: help setup dev-ui dev-api test test-unit test-integration build docker-up docker-down

help:
	@echo "Commandes disponibles :"
	@echo "  make setup            - Installation des dépendances (virtuelles & npm)"
	@echo "  make dev-ui           - Lance le frontend Next.js en développement"
	@echo "  make dev-api          - Lance le backend FastAPI en développement"
	@echo "  make test             - Lance tous les tests"
	@echo "  make docker-up        - Démarre la stack complète via Docker Compose"
	@echo "  make docker-down      - Arrête la stack Docker"

setup:
	@echo "Installation des dépendances avec uv..."
	uv sync
	@if [ -d "apps/annotation-ui" ]; then cd apps/annotation-ui && npm install; fi

dev-ui:
	cd apps/annotation-ui && npm run dev

dev-api:
	cd apps/api && uv run uvicorn main:app --reload --port 8000

test: test-unit test-integration

test-unit:
	uv run pytest tests/unit

test-integration:
	uv run pytest tests/integration

docker-up:
	cd infra/docker && docker-compose up -d

docker-down:
	cd infra/docker && docker-compose down
