# Contributing to VISTA

Thank you for helping improve **VISTA – Visual Inspection for Smart Trial Applications**. This guide summarizes how to get set up, work with Jira, branch, commit, open PRs, and keep research reproducible.

---

## 1. Prerequisites
- [uv](https://docs.astral.sh/uv/) (Universal package manager replacing pip/poetry)
- Git
- Access to the GitHub repository
- Access to **Jira** for planned development work

---

## 2. Getting Started
1. Clone the repository  
   ```bash
   git clone https://github.com/<org>/<repo>.git
   cd <repo>
   ```
2. Install all dependencies via the Makefile:
   ```bash
   make setup
   ```
3. Start the development environment:
   - Frontend: `make dev-ui`
   - Backend: `make dev-api`
   - Docker: `make docker-up`

---

## 3. Jira‑First Workflow
- All planned work must have a **Jira ticket** (Story, Task, or Bug).
- Before coding: ensure a ticket exists, assign it to yourself, and link your branch to it.
- Exploratory work without a ticket is allowed only on `test/` or `tmp/` branches (see §4.2).

---

## 4. Branching Strategy
### 4.1 Ticketed work (from `main`)
- Naming: `feature/<JIRA-KEY>-short-description` or `bugfix/<JIRA-KEY>-short-description`
- Examples: `feature/RND-VISTA-12-add-image-baseline`, `bugfix/RND-VISTA-8-fix-evaluation-metric`
- Rules: one ticket → one branch; Jira key required; merge only via PR.

### 4.2 Temporary / experimental (no Jira)
- Naming: `test/<short-description>` or `tmp/<short-description>`
- Examples: `test/try-new-augmentation`, `tmp/debug-image-loading`
- Rules: not meant to be merged; may be deleted anytime; if relevant, create a Jira ticket and move to a proper branch.

---

## 5. Commit Guidelines
- Format: `<JIRA-KEY>: short imperative description`
- Examples: `RND-VISTA-12: add MVTec AD dataloader`, `RND-VISTA-5: implement baseline autoencoder`
- Keep commits small and focused; avoid unrelated changes.
- Commits without Jira keys are allowed **only** on `test/` or `tmp/` branches.

---

## 6. Pull Requests
### 6.1 Opening a PR
- Target branch: `main`
- Include the Jira key in the PR title, e.g., `[RND-VISTA-12] Add image anomaly detection baseline`
- Use the PR template.

### 6.2 PR content
- Clear description of the change
- Link to the Jira ticket
- Summary of experiments/results (metrics, datasets, configs)
- Links to tracking (MLflow / W&B) when applicable
- Note any skipped checks; update docs if behavior changes

---

## 7. Review & Merge
- At least **one approval** required; all CI checks must pass.
- Resolve all review comments.
- Rebase on `main` if needed, then **squash-and-merge** with a Jira-keyed message.
- Direct merges into `main` are not allowed.

---

## 8. Code Quality
- Follow **PEP 8**; target line length ≤ 88; clear naming and docstrings.
- Avoid hard-coded paths, parameters, or secrets.
- Run available linters/formatters (e.g., `black`, `ruff`, `flake8`) and keep dependencies minimal.

---

## 9. Testing
- Run unit or smoke tests before opening a PR.
- Ensure scripts run on a small dataset/sample.
- Tests live in `tests/`.

---

## 10. Research Best Practices
- Ensure experiments are **reproducible**; track configs, seeds, and parameters.
- Link results to commits and Jira tickets.
- Record key decisions/findings in `docs/` (e.g., `docs/experiments.md`).

---

## 11. Documentation
- If you change data handling, models/training, or evaluation protocols, update the relevant docs in `docs/`.

---

## 12. Getting Help
- Check `README.md` and `docs/`.
- Open a GitHub Issue (Bug Report or Research Discussion).
- Ask during project syncs or team channels.
