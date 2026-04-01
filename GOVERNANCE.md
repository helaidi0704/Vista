# Governance & Development Workflow

This document defines the governance rules, development workflow, and best practices
for this project.  
It applies to all contributors and is intended to ensure code quality, traceability,
and smooth collaboration.

This document is **living** and may evolve as the project progresses.

---

## 1. Branching Strategy

The repository follows a **GitHub Flow** strategy for simplicity and speed:

- `main`  
  The single source of truth. Code merged here is considered stable, deployed (or deployable), and production-ready.

### Protected branches
Direct pushes to `main` are **not allowed**.
All changes must go through Pull Requests.

---

## 2. Working Branches

### 2.1 Feature and bugfix branches (linked to Jira)

All development work related to a Jira ticket **must** be done in a dedicated branch.

#### Naming convention

feature/<JIRA-KEY>-short-description
bugfix/<JIRA-KEY>-short-description


#### Examples

feature/RND-VISTA-12-add-image-baseline
feature/RND-VISTA-5-mvtec-dataloader
bugfix/RND-VISTA-8-fix-evaluation-metric


Rules:
- One Jira ticket = one branch
- Branches must be created from `main`
- Branch names must include the Jira key

---

### 2.2 Experimental / temporary branches (no Jira ticket)

Contributors may create temporary branches for **exploration, tests, or experiments**
that are **not directly linked to a Jira ticket**.

#### Naming convention

test/<short-description>
tmp/<short-description>


#### Examples

test/try-new-augmentation
tmp/debug-image-loading


Rules:
- These branches are **not meant to be merged** into `develop`
- They may be deleted at any time
- If the work becomes relevant, a Jira ticket **must be created**, and the work
  migrated to a proper `feature/` or `bugfix/` branch

---

## 3. Commit Message Convention

All commits related to Jira tickets **must include the Jira key**.

#### Format

<JIRA-KEY>: short, imperative description


#### Examples

RND-VISTA-12: add MVTec AD dataloader
RND-VISTA-5: implement baseline autoencoder


Rules:
- Use short, clear, imperative messages
- Commits without Jira keys are allowed **only** on `test/` or `tmp/` branches

---

## 4. Pull Requests (PR)

All changes to protected branches must go through a Pull Request.

### 4.1 Creating a PR

- Target branch: `main`
- PR title must include the Jira key

Example:

[RND-VISTA-12] Add image anomaly detection baseline


The PR description should include:
- Objective of the change
- Link to the Jira ticket
- Summary of results (metrics, experiments, observations)
- Any relevant links (e.g., MLflow / W&B runs)

---

### 4.2 Review and approval

A PR can be merged only if:
- At least **one approval** is given
- CI checks pass
- All review comments are resolved

---

### 4.3 Merge strategy

The default merge strategy is:

👉 **Squash and merge**

Rules:
- Before merging, the branch **must be rebased** on top of `main`
- The squash commit message must include the Jira key

Example squash commit message:

RND-VISTA-12: add image anomaly detection baseline


---

## 5. Jira ↔ GitHub Integration

Traceability between Jira and GitHub is mandatory.

A Jira ticket is automatically linked to GitHub when the Jira key appears in:
- Branch name
- Commit message
- Pull Request title

Rules:
- Every Story or Bug in Jira must have at least one linked commit or PR
- No code should be merged into `main` without an associated Jira ticket
  (except for `test/` and `tmp/` branches)

---

## 6. Code Style and Quality

### 6.1 Python code conventions

All Python code must follow **PEP 8** conventions.

In particular:
- Clear and explicit naming
- Line length ≤ 88 characters (recommended)
- Consistent imports ordering
- Meaningful docstrings for public functions and classes

Automated formatting and linting tools (e.g., `black`, `ruff`, `flake8`) may be enforced
via CI as the project evolves.

---

## 7. Continuous Integration (CI)

CI checks are required before merging any PR and may include:
- Code formatting and linting
- Unit or smoke tests
- Basic execution checks

CI rules may be extended over time as the project matures.

---

## 8. Reproducibility and Research Discipline

This project follows research-oriented best practices:
- Experimental results must be reproducible
- Configurations, seeds, and parameters must be tracked
- Important results must be traceable to commits and PRs

Detailed rules regarding:
- configuration files format
- experiment tracking
- data management

will be added in future versions of this document.

---

## 9. Evolution of this document

This governance document is expected to evolve.

Future additions may include:
- Configuration file standards
- Experiment tracking conventions
- Data versioning rules
- Release and tagging policies

Any change to this document must be discussed and approved via a Pull Request.

---

## 10. Architecture Monorepo

VISTA est structuré en Monorepo. Les règles suivantes s'appliquent :
- `apps/` : Contient les applications web déployables (UI Next.js, API FastAPI).
- `services/` : Contient les microservices et le cœur ML (`ml-core`).
- `libs/` : Contient les librairies partagées (`image-utils`, etc.). Aucune logique métier spécifique ne doit s'y trouver.
- `infra/` : Contient la configuration de déploiement (Docker, CI/CD).

Les dépendances de `libs/` peuvent être importées dans `apps/` ou `services/`, mais **jamais l'inverse**.

---

## Pull Request Template

All Pull Requests must follow the standard PR template defined in:

.github/pull_request_template.md

The template ensures:
- proper linkage with Jira tickets
- clear description of changes
- traceability of experimental results
- reproducibility and code quality checks

PRs not following the template may be rejected or sent back for completion.


GitHub Issues are used only for bug reports or research discussions.
All planned development work must be tracked in Jira.

---