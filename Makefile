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
	@if [ -d "frontend" ]; then cd frontend && npm install; fi

dev-ui:
	cd frontend && npm start

dev-api:
	@API_PORT=$$(grep -m1 '^API_PORT=' .env 2>/dev/null | cut -d= -f2); \
	API_PORT=$${API_PORT:-8001}; \
	cd backend && uv run uvicorn app.main:app --reload --port $$API_PORT

test: test-unit test-integration

test-unit:
	uv run pytest tests/unit

test-integration:
	uv run pytest tests/integration

docker-up:
	cd infra/docker && docker compose --env-file ../../.env up -d

docker-down:
	cd infra/docker && docker compose --env-file ../../.env down
