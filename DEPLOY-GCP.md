# VISTA — Guide de Déploiement GCP

## Prérequis

Avant de commencer, assurez-vous d'avoir :

1. Un **compte GCP** avec facturation activée
2. Le **gcloud CLI** installé et configuré (`gcloud auth login`)
3. Un **quota GPU** approuvé dans votre projet (vérifier sur la [page des quotas](https://console.cloud.google.com/iam-admin/quotas), filtrer par "GPUs (all regions)")

Si vous n'avez pas de quota GPU, soumettez une demande d'augmentation — l'approbation prend généralement 1-2 jours ouvrés.

---

## Option A — Déploiement automatisé (recommandé)

Le script `deploy-gcp.sh` automatise tout le processus en une commande.

```bash
# Depuis le répertoire du projet
cd vista

# Configurer le projet GCP
export GCP_PROJECT_ID="votre-projet-id"
export GCP_ZONE="europe-west4-a"

# Lancer le déploiement complet
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

Le script va créer la VM, installer Docker et les drivers NVIDIA, puis déployer les 7 conteneurs. En fin de processus, il affiche les URLs d'accès.

**Commandes utilitaires du script :**

```bash
./deploy-gcp.sh --status   # Voir l'état des conteneurs
./deploy-gcp.sh --stop     # Arrêter la VM (économie quand pas utilisé)
./deploy-gcp.sh --start    # Relancer la VM + les conteneurs
./deploy-gcp.sh --cost     # Estimation des coûts mensuels
```

---

## Option B — Déploiement manuel étape par étape

### Étape 1 — Créer la VM

```bash
gcloud compute instances create vista-server \
    --project=VOTRE_PROJET \
    --zone=europe-west4-a \
    --machine-type=n1-standard-8 \
    --accelerator=type=nvidia-tesla-t4,count=1 \
    --maintenance-policy=TERMINATE \
    --restart-on-failure \
    --boot-disk-size=100GB \
    --boot-disk-type=pd-ssd \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --tags=vista-server,http-server
```

### Étape 2 — Ouvrir les ports firewall

```bash
gcloud compute firewall-rules create vista-allow-ports \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:3000,tcp:8000,tcp:9000,tcp:9001 \
    --target-tags=vista-server \
    --source-ranges=0.0.0.0/0
```

### Étape 3 — Se connecter à la VM

```bash
gcloud compute ssh vista-server --zone=europe-west4-a
```

### Étape 4 — Installer Docker

```bash
# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### Étape 5 — Installer les drivers NVIDIA + Container Toolkit

```bash
# Drivers NVIDIA
sudo apt-get install -y nvidia-driver-535

# NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Reboot pour activer les drivers
sudo reboot
```

Après le reboot, reconnectez-vous et vérifiez :

```bash
nvidia-smi   # Doit afficher la T4 avec 16 Go
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### Étape 6 — Déployer VISTA

```bash
# Upload du projet (depuis votre machine locale)
gcloud compute scp vista-project.tar.gz vista-server:/tmp/ --zone=europe-west4-a

# Sur la VM
cd /opt
sudo mkdir vista && sudo chown $USER:$USER vista
cd vista
tar -xzf /tmp/vista-project.tar.gz --strip-components=1

# Lancer les 7 conteneurs
docker compose up -d --build
```

Premier build : compter **10-15 minutes** (téléchargement des images Docker, notamment PyTorch ~8 Go).

### Étape 7 — Vérifier

```bash
# Santé de l'API
curl http://localhost:8000/health

# Statut des conteneurs
docker compose ps

# Logs en temps réel
docker compose logs -f api worker-gpu
```

---

## Accès à VISTA

Récupérer l'IP externe :

```bash
gcloud compute instances describe vista-server \
    --zone=europe-west4-a \
    --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
```

Puis ouvrir dans le navigateur :

| Service | URL |
|---|---|
| Frontend VISTA | `http://IP:3000` |
| API Swagger | `http://IP:8000/docs` |
| API Health | `http://IP:8000/health` |
| MinIO Console | `http://IP:9001` |

---

## Estimation des coûts

| Ressource | Coût mensuel (24/7) |
|---|---|
| VM n1-standard-8 (8 vCPU, 30 Go RAM) | ~195 $/mois |
| GPU NVIDIA T4 (1x) | ~255 $/mois |
| Disque SSD 100 Go | ~17 $/mois |
| IP statique | ~7 $/mois |
| **Total** | **~474 $/mois** |

**Optimisations possibles :**

- **Spot/Preemptible VM** : ~175 $/mois (-63%), risque d'interruption
- **Arrêter la VM la nuit** (`./deploy-gcp.sh --stop`) : ~237 $/mois (-50%)
- **Sans GPU** (dev/test uniquement) : ~195 $/mois
- **GPU L4** au lieu de T4 : performance supérieure, prix similaire

---

## Opérations courantes

```bash
# Voir les logs d'un service
docker compose logs -f worker-gpu

# Redémarrer un service
docker compose restart api

# Mettre à jour le code
cd /opt/vista
git pull   # ou re-upload le tar.gz
docker compose up -d --build

# Sauvegarder la base PostgreSQL
docker compose exec db pg_dump -U vista vista > backup_$(date +%Y%m%d).sql

# Arrêter la VM (économie — les données persistent)
./deploy-gcp.sh --stop

# Relancer la VM
./deploy-gcp.sh --start
```

---

## Sécurité (production)

Pour une mise en production sérieuse, pensez à :

1. **HTTPS** : ajouter un reverse proxy Nginx avec Let's Encrypt (le fichier `nginx/nginx.conf` est fourni)
2. **Firewall** : restreindre `source-ranges` aux IPs de votre entreprise
3. **Mots de passe** : le script génère des secrets aléatoires dans `.env`
4. **Backups** : programmer un cron pour `pg_dump` quotidien vers Cloud Storage
5. **Monitoring** : ajouter Prometheus + Grafana (conteneurs supplémentaires)
