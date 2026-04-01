# CI/CD (Continuous Integration / Continuous Deployment)

L'infrastructure CI/CD de VISTA est basée sur **GitHub Actions**.

## Workflows actuels
1. **CI `ci.yml`** : Exécuté sur chaque push vers `develop`, `staging`, `prod` ou sur chaque nouvelle PR.
    - Lance les tests Python frontend (pytest)
    - Lance les linters frontend (ESLint) et l'installation Node

## A venir (Roadmap)
- Intégration de SonarQube pour l'analyse stricte
- Pipelines ML de retraining automatique
- Déploiement automatisé (CD) vers un registre Docker
