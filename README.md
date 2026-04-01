# VISTA — Visual Inspection for Smart Trial Applications

![VISTA Architecture](https://img.shields.io/badge/Architecture-Monorepo-blue.svg)
![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104-009688.svg)

**VISTA** est une plateforme open-source de recherche et de développement spécialisée dans **l'inspection visuelle et la détection d'anomalies en image pour le domaine industriel**.

Ce projet est une plateforme complète (UI, API, ML Pipeline) inspirée de projets comme Label Studio, mais spécialisée dans l'inspection visuelle, la segmentation et l'analyse d'images.

---

## 🏗️ Architecture Monorepo

Le projet est structuré en **Monorepo** pour faciliter le développement de bout en bout (Data → ML → API → UI).

```text
vista/
│
├── apps/                 # Applications interactives
│   ├── annotation-ui/    # Frontend web (Next.js, UI d'annotation et segmentation)
│   └── api/              # Backend (FastAPI, orchestrateur et DB)
│
├── services/             # Microservices & Pipelines métier
│   ├── ml-core/          # Cœur ML (entraînements, notebooks, baselines)
│   └── image-processing/ # Workers de traitement d'images (Filtres, Mixup, Crop)
│
├── libs/                 # Librairies partagées
│   ├── image-utils/      # Utilitaires de traitement d'images
│   ├── dataset-utils/    # Datasets
│   └── ml-utils/         # Utilitaires ML
│
├── configs/              # Configurations globales du projet (env, infra)
│
└── infra/                # Docker, CI/CD, Déploiements
```

---

## 🛠️ Fonctionnalités Principales

- **Annotation et Visualisation** : Charger une image pour l'analyser, appliquer des filtres, annoter des parties (carrés, tracés pour contours exacts), et ajouter des descriptions textuelles.
- **Comparaison et Traitement Avancé** : Comparer deux images, tester des combinaisons de data augmentation (crop, mixup), appliquer des analyses spectrales, et traiter par lots.
- **Modélisation et Live Test** : Construire des modèles, test en direct via webcam ou upload, avec des modules d'explicabilité pour comprendre les décisions du modèle.
- **Déploiement** : Exportation des modèles sous divers formats pour une intégration industrielle.

---

## 🛠️ Stack Technique

La plateforme s'appuie sur une stack logicielle moderne :

- **Frontend** : [Next.js](https://nextjs.org/) (React), [Tailwind CSS](https://tailwindcss.com/) pour le rendu web.
- **Backend & API REST** : [FastAPI](https://fastapi.tiangolo.com/) (Python) pour une API asynchrone ultra-performante.
- **Base de données** : [PostgreSQL](https://www.postgresql.org/) (via SQLAlchemy) pour le stockage relationnel.
- **Files d'attente / Workers** : [Redis](https://redis.io/) et [Celery](https://docs.celeryq.dev/) pour l'exécution asynchrone des traitements d'images.
- **Machine Learning & Image Processing** : `opencv-python`, `Pillow`, `numpy` pour le traitement, et un pipeline d'entraînement agnostique pour les modèles (baselines).

---

## 🚀 Démarrage Rapide

### Prérequis
- Python 3.12.8 (géré automatiquement par `uv`)
- [uv](https://github.com/astral-sh/uv) (Package manager Python ultra-rapide)
- Node.js 18+ (pour le frontend)
- Docker Desktop (pour la base de données locale)

### 1. Installation globale

```bash
# 1. Cloner le projet
git clone <repo-url> && cd vista

# 2. Installer les dépendances Python via uv
uv sync

# (Optionnel) Installer les dépendances Node.js du frontend
cd apps/annotation-ui && npm install

# 3. Configurer l'environnement
cp .env.example .env
```

### 2. Lancer la plateforme localement

**Option A : Via Docker Compose (Recommandé pour tester l'API/DB)**
```bash
make docker-up
```

**Option B : Développement séparé (Recommandé pour dev)**
```bash
# Terminal 1 : Lancer l'API FastAPI (Port 8000)
make dev-api # ou : uv run uvicorn main:app --reload

# Terminal 2 : Lancer l'UI Next.js (Port 3000)
make dev-ui
```

---

## 📚 Documentation
La documentation technique et scientifique est disponible dans le dossier `docs/` :
- Architecture et Flux d'Annotation
- Modèle de base de données PostgreSQL
- Protocoles d'évaluation ML
- Guide des Datasets
- Roadmap

---

## 🤝 Contribuer

1. Lisez le [Guide de Contribution (CONTRIBUTING.md)](CONTRIBUTING.md)
2. Consultez nos règles de [Gouvernance (GOVERNANCE.md)](GOVERNANCE.md)
3. Renseignez toujours le numéro de ticket Jira (`RND-VISTA-XX`) dans vos branches et commits.
