# Contributing to VISTA

Thank you for helping improve VISTA – Visual Inspection for Smart Trial Applications. This guide summarizes how to get set up, work with Jira, branch, commit, open PRs, and keep research reproducible.

## 1) Prerequisites
- Python 3.9+
- Git
- Access to the GitHub repository
- Access to Jira for planned development work

## 2) Getting Started
Clone the repository:
```bash
git clone https://github.com/<org>/<repo>.git
cd <repo>
```
Follow `README.md` to install dependencies, configure the environment, and prepare datasets if needed.

## 3) Jira-First Workflow
- All planned work must have a Jira ticket (Story, Task, or Bug).
- Before coding: ensure a ticket exists, assign it to yourself, and link your branch to it.
- Exploratory work without a ticket is allowed only on `test/` or `tmp/` branches (see §4.2).

## 4) Branching Strategy
### 4.1 Ticketed work (from `develop`)
- **Naming:** `feature/<JIRA-KEY>-short-description`, `bugfix/<JIRA-KEY>-short-description`
- **Examples:**  
  - `feature/RND-VISTA-12-add-mvtec-baseline`  
  - `bugfix/RND-VISTA-8-fix-evaluation-metric`
- **Rules:** one Jira ticket → one branch; Jira key required in branch name; merge only via Pull Request.

### 4.2 Temporary / experimental (no Jira)
- **Naming:** `test/<short-description>`, `tmp/<short-description>`
- **Examples:** `test/try-new-augmentation`, `tmp/debug-image-loading`
- **Rules:** not meant to be merged; may be deleted at any time; if work becomes relevant, create a Jira ticket and move to a proper `feature/` or `bugfix/` branch.

## 5) Commit Guidelines
- **Format:** `<JIRA-KEY>: short imperative description`
- **Examples:**  
  - `RND-VISTA-12: add MVTec AD dataloader`  
  - `RND-VISTA-5: implement baseline autoencoder`
- Keep commits small and focused; avoid unrelated changes. Commits without Jira keys are allowed only on `test/` or `tmp/` branches.

## 6) Pull Requests
### 6.1 Opening a PR
- Target branch: `develop`
- Include the Jira key in the PR title (e.g., `[RND-VISTA-12] Add visual anomaly detection baseline`)
- Use the Pull Request template.

### 6.2 PR content
Each PR should include:
- clear description of the change
- link to the Jira ticket
- summary of experiments and results (datasets, metrics, configs)
- links to experiment tracking (MLflow / W&B) when applicable
- notes on skipped checks, limitations, or assumptions
- updated documentation if behavior or protocols change

## 7) Review & Merge
- At least one approval is required; all CI checks must pass.
- All review comments must be resolved.
- Rebase on `develop` if needed, then squash-and-merge with a Jira-keyed commit message.
- Direct merges into `develop`, `staging`, or `prod` are not allowed.

## 8) Code Quality
- Follow PEP 8; target line length ≤ 88.
- Use clear naming and meaningful docstrings.
- Avoid hard-coded paths, parameters, or secrets.
- Run available linters/formatters (e.g., black, ruff, flake8).
- Keep dependencies minimal and justified.

## 9) Testing
- Run unit or smoke tests before opening a PR.
- Ensure scripts run correctly on a small dataset or sample.
- Tests are located in the `tests/` directory.

## 10) Research Best Practices
- Ensure experiments are reproducible.
- Track configurations, random seeds, and parameters.
- Link results to commits and Jira tickets.
- Record key decisions and findings in `docs/` (e.g., `docs/experiments.md`).

## 11) Documentation
If your contribution impacts data handling, preprocessing or augmentations, models or training, or evaluation protocols, update the relevant documentation in `docs/`.

## 12) Getting Help
- Check `README.md` and `docs/`.
- Open a GitHub Issue (Bug Report or Research Discussion).
- Ask during project syncs or team communication channels.

---
✔️ This CONTRIBUTING.md is aligned with VISTA, clear for newcomers, and ready for R&D/audit contexts. Possible next steps: diff check between SCOPE and VISTA governance files, generate `docs/dataset.md` for VISTA, or prep a Sprint 0 backlog.
