# ml-core

**Rôle :** Cœur du pipeline de Machine Learning expérimental.
Historiquement, il s'agissait du dossier principal (`src/scope/`) pour l'entraînement des baselines (DCASE, MIMII).

Dans l'architecture monorepo, ce service agit comme un "pipeline offline", capable de lire les données exportées par l'API pour lancer des apprentissages ou générer des modèles.
