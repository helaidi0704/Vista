# VISTA — Visual Inspection for Smart Trial Applications

![VISTA Architecture](https://img.shields.io/badge/Architecture-Monorepo-blue.svg)
![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104-009688.svg)

**VISTA** is an open-source research and development platform specialized in **visual inspection and image anomaly detection for industrial applications**.

This project provides a comprehensive platform (UI, API, ML Pipeline) inspired by projects like Label Studio, uniquely tailored for visual inspection, image segmentation, and image analysis tasks.

---

## 🏗️ Monorepo Architecture

The project uses a **Monorepo** structure to facilitate end-to-end development (Data → ML → API → UI).

```text
vista/
│
├── apps/                 # Interactive web applications
│   ├── annotation-ui/    # Frontend web (Next.js, Annotation and segmentation UI)
│   └── api/              # Backend (FastAPI, orchestrator and DB)
│
├── services/             # Microservices & Domain Pipelines
│   ├── ml-core/          # Core ML (training, notebooks, baselines)
│   └── image-processing/ # Image processing workers (Filters, Mixup, Crop)
│
├── libs/                 # Shared libraries
│   ├── image-utils/      # Image processing utilities
│   ├── dataset-utils/    # Datasets loaders and managers
│   └── ml-utils/         # ML utilities
│
├── configs/              # Global project configurations (env, infra)
│
└── infra/                # Docker, CI/CD, Deployments
```

---

## 🛠️ Main Features

- **Annotation and Visualization**: Load images for analysis, apply filters, annotate areas (bounding boxes, freehand traces for exact contours), and add textual descriptions.
- **Comparison and Advanced Processing**: Compare multiple images, test combinations of data augmentation (crop, mixup, etc.), apply spectral analyses, and execute batch processing workloads.
- **Modeling and Live Testing**: Train machine learning models, run live tests using a webcam or file uploads, and leverage explainability modules to interpret model decisions.
- **Deployment**: Export models in various formats ready for industrial deployment.

---

## 🛠️ Tech Stack

The platform is built on a modern software stack designed for performance and simple deployment:

- **Frontend**: [Next.js](https://nextjs.org/) (React) and [Tailwind CSS](https://tailwindcss.com/) for web rendering.
- **Backend & REST API**: [FastAPI](https://fastapi.tiangolo.com/) (Python) for an ultra-fast asynchronous API.
- **Database**: [PostgreSQL](https://www.postgresql.org/) (via SQLAlchemy) for relational metadata storage.
- **Queues / Workers**: [Redis](https://redis.io/) and [Celery](https://docs.celeryq.dev/) for asynchronous background execution of image processing tasks.
- **Machine Learning & Image Processing**: `opencv-python`, `Pillow`, and `numpy` for core processing, featuring an agnostic training pipeline for models (baselines).

---

## 🚀 Quick Start

### Prerequisites
- Python 3.12.8 (managed automatically by `uv`)
- [uv](https://github.com/astral-sh/uv) (Lightning-fast Python package manager)
- Node.js 18+ (for the frontend)
- Docker Desktop (for the local database)

### 1. Global Installation

```bash
# 1. Clone the repository
git clone <repo-url> && cd vista

# 2. Install Python dependencies using uv
uv sync

# (Optional) Install Node.js dependencies for the frontend
cd apps/annotation-ui && npm install

# 3. Configure the environment
cp .env.example .env
```

### 2. Run the Platform Locally

**Option A: Via Docker Compose (Recommended for testing the API/DB)**
```bash
make docker-up
```

**Option B: Separate Development (Recommended for development)**
```bash
# Terminal 1: Run the FastAPI backend (Port 8000)
make dev-api # or: uv run uvicorn main:app --reload

# Terminal 2: Run the Next.js UI (Port 3000)
make dev-ui
```

---

## 📚 Documentation
Technical and scientific documentation can be found in the `docs/` directory:
- Architecture and Annotation Flow
- PostgreSQL Database Schema
- ML Evaluation Protocols
- Dataset Guide
- Roadmap

---

## 🤝 Contributing

1. Read the [Contribution Guide (CONTRIBUTING.md)](CONTRIBUTING.md)
2. Review our [Governance Rules (GOVERNANCE.md)](GOVERNANCE.md)
3. Always include the Jira ticket number (`RND-VISTA-XX`) in your branches and commits.
