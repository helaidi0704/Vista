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
	cd backend && uv run uvicorn app.main:app --reload --port 8000

test: test-unit test-integration

test-unit:
	uv run pytest tests/unit

test-integration:
	uv run pytest tests/integration

docker-up:
	cd infra/infra/docker && docker-compose up -d

docker-down:
	cd infra/infra/docker && docker-compose down
