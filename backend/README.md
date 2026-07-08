# backend
FastAPI backend for the VISTA project. Implements the health check plus the 4 annotation
module endpoints (see [docs/VISTA_Contrat_Interface_Annotation_V02.md](../docs/VISTA_Contrat_Interface_Annotation_V02.md)),
backed by PostgreSQL via SQLAlchemy + Alembic.
## Requirements
- Python >= 3.12.9
- uv
- Docker (for a local PostgreSQL instance)
## Setup
From the repo root, start a local PostgreSQL instance:
```
docker compose -f infra/infra/docker/docker-compose.yml up -d
```
From the `backend/` directory, install dependencies and apply migrations:
```
uv sync
uv run alembic upgrade head
```
`uv run alembic upgrade head` creates the `app` PostgreSQL schema (users, defect_classes,
datasets, images, annotations — see [docs/database/schema_v1.md](../docs/database/schema_v1.md))
and seeds the 5 `defect_classes` rows used by the frontend's defect dropdown.
Copy `.env.example` to `.env` and adjust `DATABASE_URL` if your local Postgres isn't on the
default `docker-compose` port (5442).
## Run locally
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
The backend will be available at:
http://127.0.0.1:8000
Health check:
GET http://127.0.0.1:8000/health
Interactive API documentation:
http://127.0.0.1:8000/docs
## Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/images` | Register an image (decodes base64 `src`, stores it under `data/images/`) |
| DELETE | `/api/images/{imageId}` | Delete an image and cascade-delete its annotations |
| POST | `/api/images/save-annotations` | Create/update annotations for an image |
| DELETE | `/api/annotations/{id}` | Delete a persisted annotation |
CORS is enabled for `http://localhost:4200` (the Angular dev server).
## Database migrations
```
uv run alembic revision --autogenerate -m "description"   # create a new migration
uv run alembic upgrade head                                # apply migrations
uv run alembic downgrade -1                                 # roll back one migration
```
## Quality checks
Run tests (requires the local PostgreSQL instance to be running):
uv run pytest
Run lint:
uv run ruff check .
Run formatter:
uv run ruff format .
## Security notes
- No secrets must be committed.
- Use `.env.example` only for non-sensitive example values.
- Runtime errors must not expose stack traces, local paths, environment variables, or secrets in HTTP responses.
- No authentication system exists yet; the `app.users` table exists for schema/FK completeness only.