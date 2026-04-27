# VISTA — Visual Inspection for Smart Industrial Applications

> AI-powered visual inspection platform for industrial defect detection.  
> Full MLOps pipeline: annotate → train → deploy → monitor.

![Python](https://img.shields.io/badge/Python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green)
![PyTorch](https://img.shields.io/badge/PyTorch-2.3-red)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![MLflow](https://img.shields.io/badge/MLflow-2.14-blue)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)
![GCP](https://img.shields.io/badge/GCP-Compute%20Engine-yellow)

## What is VISTA?

VISTA is an end-to-end platform for visual quality inspection in manufacturing. It covers the complete lifecycle from data collection to production deployment:

1. **Upload & Annotate** — Drag & drop industrial images, draw bounding boxes, classify defects (scratch, porosity, crack, burr)
2. **Analyze & Compare** — Side-by-side comparison, spectral analysis (FFT), Sobel/Canny filters, data augmentation preview
3. **Train Models** — Visual pipeline builder, configurable hyperparameters, real-time training metrics via WebSocket
4. **Test & Explain** — Live inference with Grad-CAM explainability, confidence scores, verdict (OK/anomaly)
5. **Deploy & Monitor** — Export to ONNX/TensorRT/Docker/REST API, latency monitoring, data drift detection

## Architecture
**8 Docker containers** orchestrated with Docker Compose, deployable on any cloud (GCP, AWS, Azure) or on-premise.

## MLOps Features

| Feature | Implementation |
|---|---|
| **Experiment Tracking** | MLflow — logs hyperparams, per-epoch metrics, model artifacts |
| **Model Registry** | MLflow — versioning (v1, v2...), stage transitions (Staging → Production) |
| **Dataset Versioning** | Custom — content-hashed snapshots stored in MinIO, comparable diffs |
| **Data Drift Detection** | Custom — confidence drift, anomaly rate shift, latency spikes, class distribution KL divergence |
| **Alerting** | Redis Pub/Sub + Slack webhook + email (SMTP) |
| **CI/CD** | GitHub Actions — lint, test, build Docker images, deploy to GCP |

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, Recharts |
| Backend | FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, Celery, WebSocket |
| ML | PyTorch 2.3, Ultralytics (YOLOv8), Albumentations, Grad-CAM |
| Storage | PostgreSQL 15 (11 tables, JSONB), Redis 7, MinIO (S3-compatible) |
| MLOps | MLflow 2.14, custom drift detector, dataset versioner |
| Infra | Docker Compose, GCP Compute Engine, GitHub Actions |

## Quick Start

### Prerequisites
- Docker & Docker Compose v2
- 8 GB RAM minimum

### Run locally
```bash
git clone https://github.com/YOUR_USERNAME/vista.git
cd vista
cp .env.example .env
docker compose up -d --build
# Wait 3-5 min for first build, then:
# Frontend:  http://localhost:3000
# API docs:  http://localhost:8000/docs
# MLflow:    http://localhost:5000
# MinIO:     http://localhost:9001 (vistaadmin / vistaSecretKey2024)
```

### Deploy on GCP
```bash
chmod +x deploy.sh
./deploy.sh
# Creates VM, installs Docker + NVIDIA, deploys all 8 containers
```

## Dataset

Tested with the [Kaggle Casting Product Dataset](https://www.kaggle.com/datasets/ravirajsinh45/real-life-industrial-dataset-of-casting-product) — 8,648 real industrial images of submersible pump impellers with surface defects.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Service health (DB, Redis, MinIO status) |
| POST | `/api/v1/images/upload` | Upload images to a dataset |
| POST | `/api/v1/annotations` | Create defect annotation (bbox/freehand) |
| POST | `/api/v1/training-jobs` | Launch model training (async, GPU) |
| WS | `/api/v1/ws/training/{id}` | Real-time training metrics stream |
| POST | `/api/v1/inference` | Run inference on an image |
| POST | `/api/v1/deployments` | Export model (ONNX/TensorRT/Docker) |
| POST | `/api/v1/mlops/drift-analysis/{id}` | Run data drift detection |
| POST | `/api/v1/mlops/dataset-snapshot` | Create dataset version |
| GET | `/api/v1/mlops/alerts` | Get monitoring alerts |

## Project Structure
## Author

**Houssem Elaidi** — AI & Computer Vision Engineer  
Built as a full-stack MLOps demonstration project.

## License

MIT
