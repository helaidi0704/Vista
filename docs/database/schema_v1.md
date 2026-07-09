# VISTA — Documentation du schéma de base de données

**Version :** 2.0  
**Base :** PostgreSQL  
**Fichier source :** [`schema_v1.dbml`](./schema_v1.dbml)

---

## Architecture : deux schémas distincts

La base de données est organisée en deux schémas PostgreSQL avec une dépendance unidirectionnelle :

```
schéma app  ──────▶  schéma ai
(données métier)     (données ML)
```

| Schéma | Rôle | Piloté par |
|--------|------|------------|
| `app`  | Données créées par les utilisateurs humains (images, annotations, référentiels) | Annotateurs, data managers |
| `ai`   | Données produites par la chaîne ML (modèles, entraînements, déploiements) | Data scientists, MLOps |

> **Règle fondamentale :** `ai` peut référencer des tables `app`. `app` ne connaît jamais `ai`.

---

## Schéma `app` — Données métier

### `app.users`

Utilisateur de la plateforme (annotateur, data manager, data scientist, admin). Référencé par les colonnes `createdBy`/`updatedBy` des tables des schémas `app` et `ai`.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique généré automatiquement |
| `email` | `varchar(255)` UNIQUE | Adresse email de connexion |
| `password_hash` | `varchar(255)` | Hash du mot de passe (bcrypt/argon2) — authentification locale en attendant une connexion SSO/Active Directory |
| `full_name` | `varchar(255)` | Nom complet affiché |
| `role` | `varchar(50)` | Rôle applicatif : `annotator` / `data_manager` / `data_scientist` / `admin` |
| `is_active` | `boolean` | Compte actif ou désactivé |
| `is_email_verified` | `boolean` | `true` une fois le compte confirmé après le signup — `false` tant que la confirmation n'a pas eu lieu (première connexion) |
| `created_at` | `timestamptz` | Date de création du compte |
| `updated_at` | `timestamptz` | Date de dernière modification |

---

### `app.defect_classes`

Référentiel des types de défauts reconnus par la plateforme. Table de seed — les valeurs sont définies par l'équipe, pas par les utilisateurs.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `serial` PK | Identifiant numérique auto-incrémenté |
| `label` | `varchar(100)` UNIQUE | Libellé affiché — ex : `Rayure profonde`, `Fissure (micro)`, `Décoloration / Tâche`, `Défaut d'usinage (Bavure)`, `Pièce manquante` |
| `description` | `text` | Description métier optionnelle du défaut |

---

### `app.datasets`

Regroupement logique d'images annotées constituant un jeu de données. Point de jonction entre le monde métier (`app`) et la chaîne ML (`ai`) : créé par le data manager, consommé par les entraînements.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique généré automatiquement |
| `name` | `varchar(255)` UNIQUE | Nom du dataset — ex : `Dataset_Carter_Moteur` |
| `description` | `text` | Description libre du dataset |
| `created_at` | `timestamptz` | Date de création |
| `updated_at` | `timestamptz` | Date de dernière modification |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant créé le dataset |
| `updatedBy` | `uuid` FK → `app.users` | Utilisateur ayant fait la dernière modification |

---

### `app.images`

Image industrielle importée dans le module d'annotation. Contient les métadonnées du fichier et son chemin de stockage. Une image peut exister indépendamment d'un dataset.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique — format frontend : `upload_{timestamp}_{random}` |
| `dataset_id` | `uuid` FK → `app.datasets` | Dataset auquel appartient l'image. Nullable : une image peut exister hors dataset |
| `name` | `varchar(255)` | Nom de fichier original — ex : `carter_moteur_082.jpg` |
| `storage_path` | `text` NOT NULL | Chemin de stockage physique (S3, MinIO ou local) |
| `format` | `varchar(10)` | Format du fichier — ex : `PNG`, `JPG` |
| `image_hash` | `varchar(100)` UNIQUE | Empreinte SHA-256 du contenu — empêche l'import de doublons |
| `size_bytes` | `int` | Taille du fichier en octets (optionnel) |
| `width` | `int` | Largeur en pixels |
| `height` | `int` | Hauteur en pixels |
| `status` | `image_status` | État dans le workflow : `pending` / `draft` / `ready` |
| `created_at` | `timestamptz` | Date d'import |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant importé l'image |

**Valeurs de `status` :**

| Valeur | Signification |
|--------|---------------|
| `pending` | Image importée, aucune annotation sauvegardée |
| `draft` | Brouillons d'annotation en cours dans le kanban |
| `ready` | Annotations confirmées et sauvegardées |

---

### `app.annotations`

Annotation géométrique persistée sur une image. Table centrale du module d'annotation, alimentée exclusivement par des sauvegardes explicites de l'utilisateur (`POST /api/images/save-annotations`). Les brouillons restent dans le cache navigateur jusqu'à validation.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique de l'annotation |
| `image_id` | `uuid` FK → `app.images` | Image sur laquelle porte l'annotation |
| `defect_class_id` | `int` FK → `app.defect_classes` | Type de défaut détecté — NOT NULL, doit référencer une classe connue |
| `severity` | `annotation_severity` | Criticité : `Critique` / `Majeur` / `Mineur` |
| `description` | `text` | Description contextuelle saisie par l'annotateur |
| `geometry_type` | `geometry_type` | Type de forme : `bbox` / `polygon` / `freehand` |
| `geometry_data` | `jsonb` | Coordonnées normalisées (0–1) de la géométrie — voir format ci-dessous |
| `created_at` | `timestamptz` | Date de création |
| `updated_at` | `timestamptz` | Date de dernière modification |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur créateur de l'annotation |
| `updatedBy` | `uuid` FK → `app.users` | Utilisateur ayant fait la dernière modification |

**Format de `geometry_data` selon `geometry_type` :**

```json
// bbox — Rectangle : coin haut-gauche + dimensions, valeurs 0..1
{ "type": "bbox", "bbox": { "nx": 0.45, "ny": 0.35, "nw": 0.15, "nh": 0.30 } }

// polygon — Polygone fermé, minimum 3 points
{ "type": "polygon", "polygon": { "points": [{"nx": 0.38, "ny": 0.35}, ...], "closed": true } }

// freehand — Tracé libre non fermé, minimum 2 points
{ "type": "freehand", "freehand": { "points": [{"nx": 0.12, "ny": 0.20}, ...], "closed": false } }
```

**Contraintes CHECK appliquées :**
- `bbox` : `nw > 0` et `nh > 0`
- `polygon` : au moins 3 points dans le tableau
- `freehand` : au moins 2 points dans le tableau

---

## Schéma `ai` — Données ML / IA

### `ai.ml_models`

Modèle de vision entraîné et versionné. Porte les informations d'architecture, les métriques de performance et le cycle de vie du modèle.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique du modèle |
| `name` | `varchar(255)` UNIQUE | Nom convention `{Family}_{Task}_v{N}` — ex : `YOLOv8_Detect_v3` |
| `family` | `model_family` | Architecture : `yolov8` / `resnet` / `unet` / `cnn_custom` / `vit` / `autoencoder` |
| `task_type` | `model_task` | Tâche visuelle : `detection` / `classification` / `segmentation` |
| `primary_metric_type` | `metric_type` | Type de métrique principale : `mAP` / `accuracy` / `IoU` |
| `primary_metric_value` | `decimal(6,4)` | Valeur de la métrique — ex : `0.864` pour 86.4% |
| `weights_path` | `text` | Chemin vers le fichier de poids — ex : `models/yolov8_detect_v3.pt` |
| `status` | `model_status` | Cycle de vie : `training` / `trained` / `deployed` / `archived` |
| `created_at` | `timestamptz` | Date de création |
| `trained_at` | `timestamptz` | Date de fin d'entraînement |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant créé le modèle — clé cross-schéma |

---

### `ai.training_runs`

Session d'entraînement qui produit exactement un modèle. Relation 1:1 avec `ai.ml_models` : un training run = un modèle en sortie. Un nouvel entraînement sur un modèle existant crée un nouveau modèle.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique du run |
| `model_id` | `uuid` FK UNIQUE → `ai.ml_models` | Modèle produit par ce run — contrainte 1:1 |
| `dataset_id` | `uuid` FK → `app.datasets` | Dataset d'entraînement utilisé — clé cross-schéma |
| `status` | `training_run_status` | État : `pending` / `running` / `completed` / `failed` |
| `config_snapshot` | `jsonb` | Snapshot complet des hyperparamètres au lancement — ex : `{epochs, batch_size, lr, optimizer, yolo_variant, …}` |
| `epochs_done` | `int` | Nombre d'epochs effectivement réalisées |
| `best_val_metric` | `decimal(6,4)` | Meilleure métrique de validation atteinte — ex : mAP@50 = `0.824` |
| `results_snapshot` | `jsonb` | Métriques complètes en sortie — ex : `{box_loss, val_map50, val_map95, precision, recall}` |
| `started_at` | `timestamptz` | Horodatage de démarrage |
| `finished_at` | `timestamptz` | Horodatage de fin |
| `created_at` | `timestamptz` | Horodatage de création du run |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant lancé le run — clé cross-schéma |

---

### `ai.deployments`

Instance de déploiement d'un modèle vers une cible de production. Porte toute la configuration nécessaire à l'exposition du modèle (format de sortie, endpoint, paramètres d'inférence).

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique du déploiement |
| `model_id` | `uuid` FK → `ai.ml_models` | Modèle déployé |
| `name` | `varchar(255)` | Nom du déploiement |
| `status` | `deployment_status` | État : `active` / `stopped` |
| `target_format` | `target_format` | Format cible : `api_rest` / `tensorrt` / `onnx` / `tflite` / `docker` |
| `endpoint_url` | `text` | URL de l'endpoint généré — ex : `/api/vision/v1/detect` |
| `image_format_input` | `image_format_input` | Format d'entrée accepté : `json_base64` / `multipart` |
| `resolution_max` | `varchar(20)` | Résolution maximale supportée — ex : `640x640` |
| `max_batch_size` | `int` | Nombre maximum d'images par requête batch |
| `include_gradcam` | `boolean` | Inclure la heatmap Grad-CAM dans les réponses |
| `auto_alignment` | `boolean` | Activer l'auto-alignement GPU avant inférence |
| `deployed_at` | `timestamptz` | Date de mise en production |
| `created_at` | `timestamptz` | Date de création |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant réalisé le déploiement — clé cross-schéma |

---

### `ai.evaluation_results`

Résultat d'une évaluation batch d'un modèle sur un dataset complet. Agrège les métriques de qualité (précision, rappel, mAP) et les performances système (latence, mémoire) sur l'ensemble des images du dataset.

| Colonne | Type | Rôle |
|---------|------|------|
| `id` | `uuid` PK | Identifiant unique de l'évaluation |
| `model_id` | `uuid` FK → `ai.ml_models` | Modèle évalué |
| `dataset_id` | `uuid` FK → `app.datasets` | Dataset utilisé pour l'évaluation — clé cross-schéma |
| `total_images` | `int` | Nombre d'images évaluées |
| `total_defects_found` | `int` | Nombre total de défauts détectés sur le dataset |
| `mean_ap_50` | `decimal(6,4)` | mAP@50 moyen sur l'ensemble du dataset |
| `mean_precision` | `decimal(6,4)` | Précision moyenne agrégée |
| `mean_recall` | `decimal(6,4)` | Rappel moyen agrégé |
| `mean_latency_ms` | `int` | Latence d'inférence moyenne en millisecondes |
| `mean_memory_usage_mb` | `int` | Consommation mémoire moyenne en Mo |
| `per_class_metrics` | `jsonb` | Métriques détaillées par classe de défaut — ex : `{"Bavure": {"ap": 0.92, "precision": 0.88}, "Rayure": {"ap": 0.81}}` |
| `evaluated_at` | `timestamptz` | Date de l'évaluation |
| `createdBy` | `uuid` FK → `app.users` | Utilisateur ayant déclenché l'évaluation — clé cross-schéma |

---

## Relations entre tables

```
app.defect_classes ◀──── app.annotations
app.datasets       ◀──── app.images
app.images         ◀──── app.annotations
app.users          ◀──── app.datasets, app.images, app.annotations (createdBy/updatedBy)

app.datasets  ◀──── ai.training_runs   (cross-schéma)
app.datasets  ◀──── ai.evaluation_results (cross-schéma)
app.users     ◀──── ai.ml_models, ai.training_runs, ai.deployments, ai.evaluation_results (createdBy, cross-schéma)

ai.ml_models  ──── ai.training_runs    (1:1 — un run produit un modèle)
ai.ml_models  ◀──── ai.deployments
ai.ml_models  ◀──── ai.evaluation_results
```

---

## Enums de référence

### Schéma `app`

| Enum | Valeurs |
|------|---------|
| `image_status` | `pending` · `draft` · `ready` |
| `annotation_severity` | `Critique` · `Majeur` · `Mineur` |
| `geometry_type` | `bbox` · `polygon` · `freehand` |

### Schéma `ai`

| Enum | Valeurs |
|------|---------|
| `model_family` | `yolov8` · `resnet` · `unet` · `cnn_custom` · `vit` · `autoencoder` |
| `model_task` | `detection` · `classification` · `segmentation` |
| `model_status` | `training` · `trained` · `deployed` · `archived` |
| `metric_type` | `mAP` · `accuracy` · `IoU` |
| `optimizer_type` | `AdamW` · `SGD` · `RMSprop` |
| `training_run_status` | `pending` · `running` · `completed` · `failed` |
| `deployment_status` | `active` · `stopped` |
| `target_format` | `api_rest` · `tensorrt` · `onnx` · `tflite` · `docker` |
| `image_format_input` | `json_base64` · `multipart` |
