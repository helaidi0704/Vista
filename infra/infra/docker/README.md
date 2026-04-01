# Déploiement Local & Sur Serveur

## Avec Docker Compose

L'environnement complet peut être démarré via Docker.

```bash
cd infra/docker
docker-compose up -d
```

### Services démarrés :
- **db** : PostgreSQL (port 5432)
- **redis** : Message Broker & Cache (port 6379)
- **api** : Backend FastAPI (port 8000)
- **ui** : Frontend Next.js (port 3000)

## Variables d'Environnement
Assurez-vous d'avoir créé le fichier `.env` à la racine du projet avant de lancer Docker Compose.

```bash
cp ../../.env.example ../../.env
```
