# VISTA

Visual Inspection for Smart Trial Applications  
Industrial visual anomaly detection and inspection

## 1) Project Overview

VISTA is a research and development project focused on industrial visual inspection and anomaly detection using computer vision. The goal is to design, implement, and evaluate visual anomaly detection and defect inspection methods for industrial environments using public benchmark datasets and reproducible experimental pipelines.

Project targets:
- detection of visual defects and anomalies in industrial images
- reproducible research workflows
- standardized evaluation protocols
- industrially relevant experimentation

## 2) Scope and Objectives

**In scope**
- Visual anomaly and defect detection
- Industrial inspection using computer vision
- Image-based machine learning and deep learning models
- Public datasets (e.g., MVTec AD, DAGM, BTAD)
- Reproducible experiments and benchmarking

**Out of scope**
- Real-time deployment in production systems
- Hardware integration (cameras, sensors)
- Proprietary or sensitive datasets (at this stage)

## 3) Datasets

VISTA relies primarily on publicly available industrial vision datasets, including:
- MVTec AD (industrial anomaly detection benchmark)
- DAGM Dataset (defect detection on textured surfaces)
- BTAD (BeanTech Anomaly Detection Dataset)

Dataset acquisition and preparation are handled via scripts in `scripts/`. See `docs/dataset.md` for detailed information on sources, licenses, and structure.

## 4) Project Structure

The repository follows a research-oriented, reproducible structure:

```
.
├── README.md                # Project overview and documentation
├── GOVERNANCE.md            # Project rules and development governance
├── CONTRIBUTING.md          # How to contribute to the project
├── .gitignore
├── .env.example             # Environment variables template
├── pyproject.toml           # Dependencies and tooling configuration
├── Makefile                 # Common commands (setup, train, eval, test)
│
├── .github/                 # GitHub configuration (PR templates, issue templates, CI)
│
├── configs/                 # Experiment configuration files (YAML)
│   ├── default.yaml
│   ├── dataset.yaml
│   ├── model.yaml
│   ├── train.yaml
│   └── eval.yaml
│
├── data/                    # Local data directory (not versioned)
│   ├── README.md            # Data organization and conventions
│   ├── raw/                 # Raw, unmodified datasets
│   ├── interim/             # Intermediate processing outputs
│   ├── processed/           # Data ready for training/evaluation
│   └── splits/              # Train/val/test splits (versioned)
│
├── docs/                    # Research and technical documentation
│   ├── design.md            # Scientific assumptions and design choices
│   ├── dataset.md           # Dataset descriptions and licenses
│   ├── evaluation.md        # Evaluation protocols and metrics
│   ├── experiments.md       # Experiment log (CIR-friendly)
│   └── roadmap.md           # Project milestones and versions
│
├── notebooks/               # Exploration and analysis notebooks
│   ├── 00_sanity_check.ipynb
│   ├── 01_data_exploration.ipynb
│   ├── 02_baseline_training.ipynb
│   └── 03_results_analysis.ipynb
│
├── reports/                 # Generated outputs (figures, result tables)
│   ├── figures/
│   └── results/
│
├── scripts/                 # Reproducible command-line scripts
│   ├── download_data.py
│   ├── prepare_data.py
│   ├── train.py
│   ├── evaluate.py
│   └── export_results.py
│
├── src/
│   └── vista/               # Python package (core implementation)
│       ├── data/            # Image loading, preprocessing, augmentations
│       ├── models/          # Baseline and experimental models
│       ├── training/        # Training loops and losses
│       ├── evaluation/      # Metrics and evaluation protocols
│       ├── tracking/        # Experiment tracking (e.g., MLflow)
│       └── utils/           # Shared utilities (config, logging, seeds)
│
├── tests/                   # Unit and smoke tests
│   ├── test_data_pipeline.py
│   ├── test_models_smoke.py
│   ├── test_evaluation.py
│   └── test_reproducibility.py
│
└── resources/               # Additional resources
    ├── sample_data/         # Small samples for quick tests
    └── references/          # Papers, links, and research notes
```

## 5) Reproducibility

Reproducibility is a core principle of the VISTA project. Practices enforced:
- configuration-driven experiments (`configs/`)
- fixed random seeds
- explicit dataset splits
- versioned code and tracked experiments
- linkage between results, commits, and Jira tickets

## 6) Development Workflow

- Jira-first approach for work tracking  
- All code changes go through Pull Requests  
- Branching strategy: `develop`, `staging`, `prod`  
- Merge strategy: rebase + squash and merge  

Refer to:
- `GOVERNANCE.md` for mandatory rules
- `CONTRIBUTING.md` for contribution guidelines

## 7) Code Quality

- Python code follows PEP 8  
- Linting and testing may be enforced via CI  
- Experimental code is expected to be readable, documented, and traceable  

## 8) Project Status

The project is under active development. Current focus:
- dataset ingestion and preprocessing
- baseline visual anomaly detection models
- evaluation protocol definition
- experiment tracking setup

See `docs/roadmap.md` for details.

## 9) License

This project is intended for internal research and development purposes. Licensing information will be specified as the project matures.

## 10) Contact

For questions or contributions:
- refer to `CONTRIBUTING.md`
- open a GitHub Issue (bug or research discussion)
- contact the project maintainers
