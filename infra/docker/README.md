# Déploiement Local & Sur Serveur

## Avec Docker Compose

```bash
cd infra/docker
docker compose --env-file ../../.env up -d
```

### Services démarrés :
- **db** : PostgreSQL 16 (port hôte **5442** → 5432 dans le conteneur, pour éviter les conflits avec
  d'autres instances Postgres locales ; utilisateur/mot de passe/DB par défaut : `vista`/`vista`/`vista`)
- **redis** : Cache/broker (port hôte 6379)
- **api** : Backend FastAPI (`backend/`), migrations Alembic appliquées au démarrage ; port hôte
  **8001** → 8000 dans le conteneur, pour éviter les conflits avec d'autres services locaux qui
  squattent souvent le 8000
- **ui** : Frontend Angular (`frontend/`), `ng serve` ; port hôte **4201** → 4200 dans le conteneur,
  même logique anti-conflit que pour l'API
- **playwright** : Tests end-to-end contre `ui`/`api` (profil manuel, `docker compose run playwright`)

## Variables d'Environnement

Les variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `API_PORT`, `UI_PORT`
peuvent être surchargées via le fichier `.env` à la racine du repo (voir `.env.example`) — c'est
la seule source de vérité pour la config DB, utilisée aussi bien par Docker Compose que par le
backend lancé hors Docker (voir `backend/app/core/config.py`). `docker-compose.yml` mappe en
interne `DB_USER`/`DB_PASSWORD`/`DB_NAME` vers `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
(noms imposés par l'image `postgres` elle-même) — ces derniers n'ont donc pas besoin d'exister
dans `.env`. `backend/.env` (voir `backend/.env.example`) ne contient que des réglages propres
au process backend (`SERVICE_NAME`, `ENVIRONMENT`, `API_PREFIX`, `DATA_DIR`) — il ne doit pas
redéfinir la config DB, pour éviter que les deux fichiers divergent.

Le port de `API_PORT` est aussi utilisé côté frontend : le conteneur `ui` régénère
`frontend/public/api-config.json` (gitignoré, via `frontend/scripts/generate-api-config.js`) à
chaque démarrage à partir de la variable `API_PORT` reçue par `env_file`. Ce fichier est fetché
au runtime par l'app (voir `frontend/src/app/core/api-config.ts`), donc le frontend pointe
toujours vers le bon port API même si `API_PORT` est personnalisé — pas besoin d'éditer un
fichier suivi par Git ni de rebuild l'image, un simple `docker compose up -d` suffit.

### Limite connue : changer `DB_USER`/`DB_PASSWORD`/`DB_NAME` sur un volume déjà initialisé

`DB_PORT`, `API_PORT` et `UI_PORT` peuvent être changés à tout moment — un simple
`docker compose up -d` recrée les conteneurs concernés automatiquement, sans perte de données
(le volume `vista_db_data` n'est jamais touché par un changement de port).

**`DB_USER`/`DB_PASSWORD`/`DB_NAME` sont différents.** L'image `postgres` n'applique
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (dérivés de ces variables, voir plus haut) que
lors de l'initialisation du répertoire de données — c'est-à-dire **seulement si le volume est
vide**. Une fois la base initialisée une première fois, changer ces variables dans `.env` et
relancer `docker compose up -d` :
- ne change rien côté Postgres (log : `Database directory appears to contain a database;
  Skipping initialization`) — le rôle/mot de passe/nom de base restent les anciens ;
- mais l'API essaie quand même de se connecter avec les **nouvelles** valeurs, et plante
  (`FATAL: password authentication failed for user "..."`).

Aucune donnée n'est perdue (le volume reste intact), mais l'app ne redémarre plus tant que
`DB_USER`/`DB_PASSWORD`/`DB_NAME` ne correspondent pas à ce avec quoi la base a été initialisée
la toute première fois. Pour changer ces valeurs sur un environnement existant, deux options :
- exécuter les `ALTER USER` / `ALTER DATABASE` correspondants directement dans Postgres
  (`docker exec -it vista-db psql -U <user_actuel> -d <db_actuelle>`) ;
- ou accepter de perdre les données locales et repartir d'un volume vide
  (`docker compose down -v` puis `docker compose up -d`).

En clair : fixez `DB_USER`/`DB_PASSWORD`/`DB_NAME` une bonne fois pour toutes avant le tout
premier `docker compose up`, sans y revenir ensuite — contrairement aux ports, qui restent
librement modifiables.
