# GitHub Copilot Instructions — VISTA Monorepo

VISTA (Visual Inspection for Smart Trial Applications) is a Python + Angular monorepo for
industrial visual inspection and image anomaly detection. Use this file to generate code
that fits the existing structure and conventions of this repository.

## Repository Architecture

This is a monorepo. Always place new code in the correct package — do not mix concerns
across boundaries.

| Path | Role | Stack |
|---|---|---|
| `backend` | FastAPI backend (annotation module: API, DB access via SQLAlchemy/Alembic) | Python / FastAPI / SQLAlchemy |
| `frontend` | Angular web application (annotation UI, training/testing/deployment pages) | Angular 21 / TypeScript |
| `libs/dataset-utils`, `libs/image-utils`, `libs/ml-utils` | Shared Python libraries reused by `backend` and `services/*` | Python |
| `services/image-processing` | Image processing worker/service (filters, augmentations, batch processing) | Python / OpenCV / Pillow / Albumentations |
| `services/ml-core` | Offline ML pipeline: training, evaluation, experiment tracking | Python |
| `infra/docker`, `infra/ci` | Docker Compose and CI/CD documentation and configuration | Docker / GitHub Actions |
| `docs/database` | PostgreSQL schema documentation (`app` and `ai` schemas) | DBML / Markdown |
| `tests` | Test suite for the Python codebase (`tests/unit`, `tests/integration` by convention) | pytest |

Several of these directories (`libs/*`, `services/*`) currently only contain scaffolding
(empty folders with `.gitkeep`). When implementing features there, follow the intended
role of the folder described above rather than improvising a new structure.

## General Principles

- Prefer small, focused, well-typed changes over large speculative refactors.
- Do not invent files, commands, or dependencies that aren't already present in
  `pyproject.toml`, `Makefile`, `frontend/package.json`, or `frontend/angular.json`.
  If something is genuinely missing, add it explicitly and mention it, or leave a
  `TODO` instead of guessing.
- Never generate, modify, or scan code inside ignored/generated folders:
  `node_modules`, `.git`, `dist`, `__pycache__`, `.venv`, `venv`, `coverage`,
  `.angular`, `.cache`.
- Keep documentation in sync: if a change affects setup, commands, architecture, or
  the database schema, update the relevant docs (`README.md`, `docs/database/*`,
  service-level `README.md`) in the same change.
- This project uses a Jira-first workflow (see `CONTRIBUTING.md`/`GOVERNANCE.md`).
  Don't fabricate ticket numbers; leave branch/commit message conventions to the user.

## Python / FastAPI (`backend`, `libs/*`, `services/*`)

- Target Python `3.12.8` (see `pyproject.toml`). Use modern type hints (`list[str]`,
  `X | None`, etc.), not `typing.List`/`typing.Optional`.
- Dependency and environment management is done with `uv` (`uv sync`, `uv run ...`).
  Do not suggest `pip install` or `poetry` commands.
- Formatting/linting: `black` (line length 88) and `ruff` (line length 88, target
  `py312`) are configured in `pyproject.toml`. Follow their defaults; don't reformat
  unrelated code.
- Structure FastAPI code using the existing `backend/app` layout:
  - `api/` — routers / endpoint definitions
  - `core/` — settings, config, security, shared app setup
  - `repositories/` — data access (SQLAlchemy queries)
  - `schemas/` — Pydantic models (request/response DTOs)
  - `services/` — business logic
- Use Pydantic v2 (`pydantic`, `pydantic-settings`) idioms (`model_config`, `Field`, etc.).
- Database access goes through SQLAlchemy; respect the two-schema design documented in
  `docs/database/schema_v1.md` (`app` = business/annotation data, `ai` = ML data). `ai`
  tables may reference `app` tables, never the reverse.
- Image processing code (`libs/image-utils`, `services/image-processing`) should use
  `opencv-python`, `Pillow`, `numpy`, and `albumentations` consistently with the rest
  of the codebase — avoid introducing a competing image library.
- Avoid hard-coded paths, credentials, or environment-specific values; use settings
  objects / environment variables instead.

## Angular / TypeScript (`frontend`)

Follow `frontend/AGENTS.md` for Angular-specific conventions, summarized here:

- Use standalone components (default in Angular v20+; never set `standalone: true`
  explicitly).
- Use signals (`signal()`, `computed()`) for state; avoid `mutate`, prefer `update`/`set`.
- Use `input()`/`output()` functions instead of `@Input()`/`@Output()` decorators.
- Use `inject()` instead of constructor injection.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` on components.
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`/`*ngFor`/`*ngSwitch`.
- Use `class`/`style` bindings instead of `ngClass`/`ngStyle`.
- Prefer Reactive Forms over template-driven forms.
- Use strict TypeScript typing; avoid `any`, prefer `unknown` when uncertain.
- New pages/features belong under `frontend/src/app/pages/<feature>/`, following the
  existing pattern (`accueil`, `analyze`, `annotation`, `deployment`, `testing`, `training`).
- Accessibility: code must pass AXE checks and meet WCAG AA (focus management, color
  contrast, ARIA attributes).

## ML / Image-Processing Code (`services/ml-core`, `services/image-processing`, `libs/ml-utils`)

- Keep experiments reproducible: track configs, seeds, and parameters explicitly
  rather than relying on globals or implicit defaults.
- Treat `services/ml-core` as an offline pipeline that consumes data exported by the
  API; it should not depend on `backend` internals directly — depend on shared code
  in `libs/*` instead.
- Prefer configuration files (under `services/ml-core/configs`) over hard-coded
  hyperparameters.
- Notebooks (`services/ml-core/notebooks`) are for exploration only; production logic
  belongs in `services/ml-core/scope` modules or `libs/ml-utils`.

## Testing

- Python tests live under `tests/` (by convention `tests/unit` and `tests/integration`,
  as referenced by the `Makefile`). Use `pytest`; add fixtures/mocks rather than
  hitting real databases or external services.
- Frontend unit tests use Vitest via `ng test` (`frontend/src/app/**/*.spec.ts`).
  Co-locate spec files next to the component/service they test.
- When adding a new backend module or Angular component, add a corresponding test in
  the same change when feasible.

## Naming Conventions

- Python: `snake_case` for modules, functions, variables; `PascalCase` for classes;
  `UPPER_SNAKE_CASE` for constants. Package folders use `kebab-case` at the top level
  (e.g. `dataset-utils`) but the importable Python package inside uses `snake_case`
  (e.g. `dataset_utils`).
- TypeScript/Angular: `kebab-case` for file names and selectors, `PascalCase` for
  classes/components, `camelCase` for variables/functions/signals.
- Keep names descriptive and consistent with the domain vocabulary already used in
  `docs/database/schema_v1.md` (e.g. `defect_classes`, `datasets`, `images`).

## Documentation

- When behavior, setup steps, or the database schema change, update the corresponding
  docs (`README.md`, `docs/database/schema_v1.md`, `services/ml-core/README.md`,
  `infra/*/README.md`) in the same change — don't leave docs stale.
- Do not add new top-level documentation files unless explicitly requested; prefer
  updating existing ones.
