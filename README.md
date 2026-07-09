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
├── apps/
│   └── api/                 # FastAPI backend (orchestrator, DB access)
│       ├── app/
│       │   ├── api/         # Routers / endpoints
│       │   ├── core/        # Settings, config, shared app setup
│       │   ├── repositories/# Data access (SQLAlchemy)
│       │   ├── schemas/     # Pydantic models
│       │   ├── services/    # Business logic
│       │   └── workers/     # Celery background tasks
│       └── utils/
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
├── infra/infra/
│   ├── ci/                    # CI/CD documentation
│   └── docker/                # Docker Compose documentation
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
| `apps/api` | FastAPI backend | Scaffolding only — folders exist, no Python source yet |
| `frontend` | Angular frontend | Implemented — Angular 21 app with SSR and page scaffolds |
| `libs/dataset-utils`, `libs/image-utils`, `libs/ml-utils` | Shared Python libraries | Scaffolding only |
| `services/image-processing` | Image processing service | Scaffolding only |
| `services/ml-core` | ML core / training pipeline | Scaffolding only (see [services/ml-core/README.md](services/ml-core/README.md)) |
| `infra/infra/docker`, `infra/infra/ci` | Infra documentation | Documentation only — no `docker-compose.yml` or extra CI config checked in yet |
| `docs/database` | Database schema documentation | Implemented — see [docs/database/schema_v1.md](docs/database/schema_v1.md) |
| `tests` | Test suite | Placeholder — no tests written yet |

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
| Docker | latest | TODO — no `docker-compose.yml` is committed yet; see [infra/infra/docker/README.md](infra/infra/docker/README.md) |

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

### 2. Backend (`apps/api`)

The FastAPI application entrypoint is not implemented yet — `apps/api/app/*` only
contains the intended folder structure (`api`, `core`, `repositories`, `schemas`,
`services`, `workers`). Once an app entrypoint exists, it can be run with:

```bash
make dev-api
```

> **TODO**: `make dev-api` currently runs `cd apps/api && uv run uvicorn main:app --reload --port 8000`,
> but no `main.py`/FastAPI app is committed yet, so this command will fail until the
> backend is implemented.

### 3. Frontend (`frontend`)

```bash
cd frontend
npm install
npm start        # ng serve — http://localhost:4200
```

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
| `uv sync` | Install/refresh Python dependencies |
| `make setup` | `uv sync` + `npm install` (TODO: still references the old `apps/annotation-ui` path, not `frontend`) |
| `make dev-api` | Run the FastAPI backend (TODO: no app entrypoint committed yet) |
| `cd frontend && npm start` | Run the Angular frontend dev server |
| `make test` | Run `test-unit` and `test-integration` via `uv run pytest` |
| `uv run pytest tests/unit` | Run Python unit tests (TODO: `tests/unit` has no tests yet) |
| `uv run pytest tests/integration` | Run Python integration tests (TODO: `tests/integration` has no tests yet) |
| `cd frontend && npm test` | Run Angular unit tests (Vitest) |
| `uv run black .` | Format Python code ([tool.black] configured in `pyproject.toml`, line length 88) |
| `uv run ruff check .` | Lint Python code ([tool.ruff] configured in `pyproject.toml`, line length 88) |
| `make docker-up` / `make docker-down` | Start/stop the Docker Compose stack (TODO: `infra/infra/docker` currently only has a README, no `docker-compose.yml`) |

---

## Documentation

- [docs/database/schema_v1.md](docs/database/schema_v1.md) — PostgreSQL schema (`app`/`ai`) documentation.
- [services/ml-core/README.md](services/ml-core/README.md) — Role of the ML core pipeline.
- [infra/infra/docker/README.md](infra/infra/docker/README.md) — Intended Docker Compose setup.
- [infra/infra/ci/README.md](infra/infra/ci/README.md) — CI/CD overview.
- [frontend/README.md](frontend/README.md) — Angular CLI usage reference.
- [frontend/AGENTS.md](frontend/AGENTS.md) — Angular coding conventions.

---

## Contributing

1. Read the [Contribution Guide](CONTRIBUTING.md).
2. Review the [Governance Rules](GOVERNANCE.md).
3. Always include the Jira ticket number (`RND-VISTA-XX`) in your branches and commits.
