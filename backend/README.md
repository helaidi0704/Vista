# backend
Minimal FastAPI backend for the VISTA project.
## Requirements
- Python >= 3.12.9
- uv
## Setup
From the `backend/` directory:
uv sync
## Run locally
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
The backend will be available at:
http://127.0.0.1:8000
Health check:
GET http://127.0.0.1:8000/health
Interactive API documentation:
http://127.0.0.1:8000/docs
## Quality checks
Run tests:
uv run pytest
Run lint:
uv run ruff check .
Run formatter:
uv run ruff format .
## Security notes
- No secrets must be committed.
- Use `.env.example` only for non-sensitive example values.
- Runtime errors must not expose stack traces, local paths, environment variables, or secrets in HTTP responses.
- The current backend is intentionally minimal and does not include database, authentication, Docker, or business APIs yet.