# VISTA — Visual Inspection for Smart Trial Applications

![Architecture](https://img.shields.io/badge/Architecture-Monorepo-blue.svg)
![Python 3.12](https://img.shields.io/badge/python-3.12.8-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688.svg)
![Angular](https://img.shields.io/badge/Angular-21-DD0031.svg)

**VISTA** is an open-source research and development platform specialized in **visual
inspection and image anomaly detection for industrial applications**.

The project provides a comprehensive platform (UI, API, ML pipeline) inspired by
projects like Label Studio, tailored for visual inspection, image segmentation, and
image analysis tasks.

> **Project status:** the repository is currently structured as a monorepo skeleton.
> The Angular frontend has real pages scaffolded; most of the Python backend, shared
> libraries, and ML/image-processing services are directory scaffolding awaiting
> implementation (see the status column in [Project Structure](#project-structure)).

---

## Project Structure

```text
vista/
├── backend/                   # FastAPI backend (annotation module, implemented)
│   └── app/
│       ├── api/              # Routers / endpoints
│       ├── core/             # Settings, config, shared app setup
│       ├── repositories/     # Data access (SQLAlchemy)
│       ├── schemas/          # Pydantic models
│       └── services/         # Business logic
│
├── frontend/                 # Angular 21 web application (SSR-enabled)
│   └── src/app/
│       ├── home/
│       └── pages/            # accueil, analyze, annotation, deployment, testing, training
│
├── services/
│   ├── image-processing/     # Image processing worker (filters, augmentations)
│   └── ml-core/               # Offline ML pipeline (training, evaluation, tracking)
│
├── libs/                      # Shared Python libraries
│   ├── dataset-utils/         # Dataset loaders and managers
│   ├── image-utils/           # Image processing utilities
│   └── ml-utils/              # ML utilities
│
├── docs/
│   └── database/              # PostgreSQL schema (schema_v1.dbml / schema_v1.md)
│
├── infra/
│   ├── ci/                    # CI/CD documentation
│   └── docker/                # Docker Compose setup (db, redis, api, ui, playwright)
│
├── configs/                   # Global project configuration (placeholder)
├── data/                       # Local data storage (placeholder, Git LFS-tracked types)
├── reports/                    # Generated reports (placeholder)
├── resources/                  # Misc resources (placeholder)
├── scripts/                    # Utility scripts (placeholder)
└── tests/                      # Test suite (unit / integration)
```

### Module status

| Path | Role | Status |
|---|---|---|
| `backend` | FastAPI backend (annotation module) | Implemented — health check + the 4 annotation endpoints (`/api/images`, `/api/images/{id}`, `/api/images/save-annotations`, `/api/annotations/{id}`), backed by PostgreSQL via SQLAlchemy/Alembic. See [backend/README.md](backend/README.md). |
| `frontend` | Angular frontend | Implemented — Angular 21 app with SSR, page scaffolds, and a working Annotation module calling the real backend over HTTP |
| `libs/dataset-utils`, `libs/image-utils`, `libs/ml-utils` | Shared Python libraries | Scaffolding only |
| `services/image-processing` | Image processing service | Scaffolding only |
| `services/ml-core` | ML core / training pipeline | Scaffolding only (see [services/ml-core/README.md](services/ml-core/README.md)) |
| `infra/docker`, `infra/ci` | Infra documentation | `infra/docker/docker-compose.yml` provides `db`, `redis`, `api` (builds `backend/`), `ui` (builds `frontend/`), and a `playwright` e2e runner |
| `docs/database` | Database schema documentation | Implemented — see [docs/database/schema_v1.md](docs/database/schema_v1.md) |
| `tests` | Test suite | Placeholder — no tests written yet (backend tests live under [backend/tests](backend/tests) instead) |

---

## Tech Stack

- **Backend & REST API**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.12), [SQLAlchemy](https://www.sqlalchemy.org/), [Celery](https://docs.celeryq.dev/) + [Redis](https://redis.io/) for async background jobs.
- **Frontend**: [Angular 21](https://angular.dev/) with SSR (`@angular/ssr`, Express server).
- **Database**: PostgreSQL (see [docs/database/schema_v1.md](docs/database/schema_v1.md) for the `app`/`ai` schema design).
- **Image processing / ML**: `opencv-python`, `Pillow`, `numpy`, `albumentations`.
- **Package management**: [uv](https://github.com/astral-sh/uv) for Python, `npm` for the frontend.

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.12.8 | Managed automatically by `uv` |
| [uv](https://github.com/astral-sh/uv) | latest | Python dependency/environment manager used across the repo |
| Node.js | 18+ | Required for the Angular frontend (see [frontend/package.json](frontend/package.json)) |
| npm | 10.x | `frontend/package.json` pins `packageManager: npm@10.8.2` |
| Docker | latest | Used to run the full stack (db/redis/api/ui); see [infra/docker/README.md](infra/docker/README.md) |

### 1. Install dependencies

```bash
# Clone the repository
git clone <repo-url> && cd vista

# Install Python dependencies (root workspace) with uv
uv sync
```

This installs the dependencies declared in [pyproject.toml](pyproject.toml), including
FastAPI, SQLAlchemy, Celery, and the image-processing/ML stack, plus the `dev` extras
(`pytest`, `black`, `ruff`, `flake8`, `httpx`) when installed with:

```bash
uv sync --extra dev
```

### 2. Backend (`backend/`)

The FastAPI application lives in `backend/` (see [backend/README.md](backend/README.md) for
full details). It has its own `pyproject.toml`/virtual environment, separate from the root
workspace. Start a local PostgreSQL instance, apply migrations, then run the API:

```bash
docker compose -f infra/docker/docker-compose.yml up -d db
cd backend
uv sync
uv run alembic upgrade head
```

```bash
make dev-api
```

`make dev-api` runs `cd backend && uv run uvicorn app.main:app --reload --port $API_PORT`,
reading `API_PORT` from the repo-root `.env` (defaults to `8001` if unset). The API is then
available at `http://localhost:$API_PORT` (docs at `/docs`), matching the contract in
[docs/VISTA_Contrat_Interface_Annotation_V02.md](docs/VISTA_Contrat_Interface_Annotation_V02.md).

### 3. Frontend (`frontend`)

```bash
cd frontend
npm install
npm start        # ng serve, on UI_PORT from the repo-root .env — http://localhost:4201 by default
```

`npm start` runs [frontend/scripts/dev-server.js](frontend/scripts/dev-server.js), which reads
`UI_PORT`/`API_PORT` from the repo-root `.env` and regenerates `frontend/public/api-config.json`
(gitignored) accordingly. The app fetches that file at startup (see
[frontend/src/app/core/api-config.ts](frontend/src/app/core/api-config.ts)) to resolve the
backend URL, so the frontend dev server always targets the backend port you actually configured
instead of a hardcoded default — and no git-tracked source file needs to be rewritten per
developer.

Other scripts available in [frontend/package.json](frontend/package.json):

| Command | Description |
|---|---|
| `npm start` | Run the Angular dev server (`ng serve`) |
| `npm run build` | Production build (`ng build`, outputs to `dist/`) |
| `npm run watch` | Development build in watch mode |
| `npm test` | Run unit tests with Vitest (`ng test`) |
| `npm run serve:ssr:vista-projet` | Run the built SSR server (`node dist/vista-projet/server/server.mjs`) |

There is currently no `lint` script defined in `frontend/package.json` — TODO if
linting is desired for the frontend.

### 4. Python libraries and services (`libs/*`, `services/*`)

`libs/dataset-utils`, `libs/image-utils`, `libs/ml-utils`, `services/image-processing`,
and `services/ml-core` are managed as part of the same `uv sync` workspace install
above. They currently contain only placeholder package directories — implementation
is TODO. See [services/ml-core/README.md](services/ml-core/README.md) for the intended
role of the ML core service.

---

## Common Commands

Commands below come from [Makefile](Makefile), [pyproject.toml](pyproject.toml), and
[frontend/package.json](frontend/package.json).

| Command | Description |
|---|---|
| `uv sync` | Install/refresh root Python dependencies |
| `make setup` | `uv sync` + `npm install` (in `frontend/`) |
| `make dev-api` | Run the FastAPI backend (`cd backend && uv run uvicorn app.main:app --reload --port 8001`) |
| `cd backend && uv run alembic upgrade head` | Apply database migrations (requires the `db` container from `make docker-up`) |
| `cd backend && uv run pytest` | Run backend tests (16 tests covering health + the 4 annotation endpoints) |
| `cd frontend && npm start` | Run the Angular frontend dev server |
| `make test` | Run `test-unit` and `test-integration` via `uv run pytest` (root-level `tests/`, unrelated to `backend/tests`) |
| `uv run pytest tests/unit` | Run Python unit tests (TODO: `tests/unit` has no tests yet) |
| `uv run pytest tests/integration` | Run Python integration tests (TODO: `tests/integration` has no tests yet) |
| `cd frontend && npm test` | Run Angular unit tests (Vitest) |
| `uv run black .` | Format Python code ([tool.black] configured in `pyproject.toml`, line length 88) |
| `uv run ruff check .` | Lint Python code ([tool.ruff] configured in `pyproject.toml`, line length 88) |
| `cd backend && uv run ruff check .` | Lint the `backend/` package (its own `pyproject.toml`, line length 100) |
| `make docker-up` / `make docker-down` | Start/stop the full Docker stack (`infra/docker/docker-compose.yml`) |

---

## Documentation

- [docs/database/schema_v1.md](docs/database/schema_v1.md) — PostgreSQL schema (`app`/`ai`) documentation.
- [services/ml-core/README.md](services/ml-core/README.md) — Role of the ML core pipeline.
- [infra/docker/README.md](infra/docker/README.md) — Docker Compose setup.
- [infra/ci/README.md](infra/ci/README.md) — CI/CD overview.
- [frontend/README.md](frontend/README.md) — Angular CLI usage reference.
- [frontend/AGENTS.md](frontend/AGENTS.md) — Angular coding conventions.

---

## Contributing

1. Read the [Contribution Guide](CONTRIBUTING.md).
2. Review the [Governance Rules](GOVERNANCE.md).
3. Always include the Jira ticket number (`RND-VISTA-XX`) in your branches and commits.
