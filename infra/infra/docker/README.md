# Déploiement Local & Sur Serveur

## Avec Docker Compose

Seule la base de données PostgreSQL est actuellement fournie via Docker Compose.
Le backend (FastAPI, dans `backend/`) et le frontend (Angular, dans `frontend/`)
se lancent pour l'instant directement avec `uv run` / `npm start` (voir le
README racine), pas encore via ce Compose.

```bash
cd infra/infra/docker
docker-compose up -d
```

### Services démarrés :
- **db** : PostgreSQL 16 (port hôte **5442** → 5432 dans le conteneur, pour éviter les conflits avec
  d'autres instances Postgres locales ; utilisateur/mot de passe/DB par défaut : `vista`/`vista`/`vista`)

### TODO (non implémenté)
- **redis** : Message Broker & Cache — pas encore nécessaire (aucun worker Celery en place)
- **api** : Backend FastAPI packagé en conteneur
- **ui** : Frontend Angular packagé en conteneur (⚠️ ce fichier mentionnait auparavant à tort "Next.js" — le frontend est Angular)

## Variables d'Environnement

Les variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` peuvent être surchargées via un
fichier `.env` placé dans `infra/infra/docker/` (Docker Compose le charge automatiquement). Le
backend lit sa propre configuration (dont `DATABASE_URL`) depuis `backend/.env` — voir
`backend/.env.example`.
