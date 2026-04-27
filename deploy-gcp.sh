#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# VISTA — Déploiement GCP (Google Cloud Platform)
# ═══════════════════════════════════════════════════════════════════════════════
#
# Ce script automatise le déploiement de VISTA sur une VM GCP avec GPU.
#
# Usage:
#   chmod +x deploy-gcp.sh
#   ./deploy-gcp.sh          # Crée la VM + déploie tout
#   ./deploy-gcp.sh --setup  # Configure uniquement une VM existante
#   ./deploy-gcp.sh --app    # Déploie l'app uniquement (VM déjà prête)
#
# Prérequis:
#   - gcloud CLI installé et configuré (gcloud auth login)
#   - Projet GCP avec facturation activée
#   - Quota GPU approuvé (vérifier: https://console.cloud.google.com/iam-admin/quotas)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Configuration (MODIFIER ICI) ────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
ZONE="${GCP_ZONE:-europe-west4-a}"            # Zone avec GPU T4 disponible
INSTANCE_NAME="${GCP_INSTANCE:-vista-server}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-n1-standard-8}"  # 8 vCPU, 30 Go RAM
GPU_TYPE="${GCP_GPU_TYPE:-nvidia-tesla-t4}"
GPU_COUNT="${GCP_GPU_COUNT:-1}"
DISK_SIZE="${GCP_DISK_SIZE:-100}"              # Go (SSD)
IMAGE_FAMILY="ubuntu-2204-lts"
IMAGE_PROJECT="ubuntu-os-cloud"

# Couleurs pour le terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[VISTA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 1 — Créer la VM GCP avec GPU
# ═══════════════════════════════════════════════════════════════════════════════
create_vm() {
    log "Création de la VM ${INSTANCE_NAME} dans ${ZONE}..."
    log "  Machine: ${MACHINE_TYPE} + ${GPU_COUNT}x ${GPU_TYPE}"
    log "  Disque: ${DISK_SIZE} Go SSD"

    # Vérifier le quota GPU
    log "Vérification des quotas GPU..."
    REGION=$(echo $ZONE | sed 's/-[a-z]$//')
    QUOTA_INFO=$(gcloud compute regions describe $REGION \
        --project=$PROJECT_ID \
        --format="json(quotas)" 2>/dev/null || echo "{}")

    # Créer la VM
    gcloud compute instances create $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --accelerator=type=$GPU_TYPE,count=$GPU_COUNT \
        --maintenance-policy=TERMINATE \
        --restart-on-failure \
        --boot-disk-size=${DISK_SIZE}GB \
        --boot-disk-type=pd-ssd \
        --image-family=$IMAGE_FAMILY \
        --image-project=$IMAGE_PROJECT \
        --metadata=startup-script='#!/bin/bash
            echo "VISTA VM started at $(date)" >> /var/log/vista-startup.log' \
        --tags=vista-server,http-server,https-server \
        --scopes=default,storage-ro

    log "VM créée ✓"

    # Créer les règles firewall
    log "Configuration du firewall..."

    # Règle pour les ports VISTA
    gcloud compute firewall-rules create vista-allow-ports \
        --project=$PROJECT_ID \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:3000,tcp:8000,tcp:9000,tcp:9001 \
        --target-tags=vista-server \
        --source-ranges=0.0.0.0/0 \
        --description="VISTA: Frontend(3000), API(8000), MinIO(9000,9001)" \
        2>/dev/null || warn "Règle firewall vista-allow-ports existe déjà"

    # Réserver une IP statique
    log "Réservation d'une IP statique..."
    gcloud compute addresses create vista-ip \
        --project=$PROJECT_ID \
        --region=$REGION \
        2>/dev/null || warn "IP statique vista-ip existe déjà"

    STATIC_IP=$(gcloud compute addresses describe vista-ip \
        --project=$PROJECT_ID \
        --region=$REGION \
        --format="value(address)" 2>/dev/null || echo "")

    if [ -n "$STATIC_IP" ]; then
        gcloud compute instances delete-access-config $INSTANCE_NAME \
            --project=$PROJECT_ID \
            --zone=$ZONE \
            --access-config-name="external-nat" 2>/dev/null || true
        gcloud compute instances add-access-config $INSTANCE_NAME \
            --project=$PROJECT_ID \
            --zone=$ZONE \
            --address=$STATIC_IP 2>/dev/null || true
        log "IP statique: ${STATIC_IP}"
    fi

    log "VM prête ✓ — attente du démarrage (30s)..."
    sleep 30
}

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 2 — Installer Docker + NVIDIA Container Toolkit sur la VM
# ═══════════════════════════════════════════════════════════════════════════════
setup_vm() {
    log "Installation de Docker et NVIDIA Container Toolkit sur ${INSTANCE_NAME}..."

    gcloud compute ssh $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --command="$(cat <<'REMOTE_SCRIPT'
#!/bin/bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  VISTA — Configuration VM GCP"
echo "═══════════════════════════════════════"

# --- Update système ---
echo "[1/6] Mise à jour système..."
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release git

# --- Docker ---
echo "[2/6] Installation de Docker..."
if ! command -v docker &>/dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    sudo usermod -aG docker $USER
    echo "Docker installé ✓"
else
    echo "Docker déjà installé ✓"
fi

# --- NVIDIA Driver ---
echo "[3/6] Installation des drivers NVIDIA..."
if ! command -v nvidia-smi &>/dev/null; then
    sudo apt-get install -y -qq linux-headers-$(uname -r)
    
    # Installer via le package Ubuntu
    sudo apt-get install -y -qq nvidia-driver-535 nvidia-utils-535
    
    echo "Drivers NVIDIA installés — un reboot sera nécessaire"
else
    echo "Drivers NVIDIA déjà installés ✓"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
fi

# --- NVIDIA Container Toolkit ---
echo "[4/6] Installation du NVIDIA Container Toolkit..."
if ! dpkg -l | grep -q nvidia-container-toolkit; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

    sudo apt-get update -qq
    sudo apt-get install -y -qq nvidia-container-toolkit
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker

    echo "NVIDIA Container Toolkit installé ✓"
else
    echo "NVIDIA Container Toolkit déjà installé ✓"
fi

# --- Répertoire projet ---
echo "[5/6] Préparation du répertoire..."
sudo mkdir -p /opt/vista
sudo chown $USER:$USER /opt/vista

# --- Swap (utile pour le build) ---
echo "[6/6] Configuration swap..."
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap 4 Go activé ✓"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Configuration terminée ✓"
echo "  Un reboot peut être nécessaire pour"
echo "  activer les drivers NVIDIA."
echo "═══════════════════════════════════════"
REMOTE_SCRIPT
)"

    log "Configuration VM terminée ✓"
    log ""
    warn "Si c'est la première installation des drivers NVIDIA, il faut rebooter:"
    echo -e "  ${BLUE}gcloud compute instances reset ${INSTANCE_NAME} --zone=${ZONE} --project=${PROJECT_ID}${NC}"
    echo -e "  Attendre 60s puis relancer: ${BLUE}./deploy-gcp.sh --app${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 3 — Déployer l'application VISTA
# ═══════════════════════════════════════════════════════════════════════════════
deploy_app() {
    log "Déploiement de VISTA sur ${INSTANCE_NAME}..."

    # Upload du projet
    log "Upload du code source..."
    gcloud compute scp ./vista-project.tar.gz $INSTANCE_NAME:/tmp/ \
        --project=$PROJECT_ID \
        --zone=$ZONE

    # Déployer sur la VM
    gcloud compute ssh $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --command="$(cat <<'DEPLOY_SCRIPT'
#!/bin/bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  VISTA — Déploiement Application"
echo "═══════════════════════════════════════"

# Extraire le code
cd /opt/vista
tar -xzf /tmp/vista-project.tar.gz --strip-components=1
rm -f /tmp/vista-project.tar.gz

# Vérifier GPU
echo "[1/4] Vérification GPU..."
if nvidia-smi &>/dev/null; then
    echo "GPU détecté:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    GPU_AVAILABLE=true
else
    echo "⚠️  Pas de GPU détecté — le worker-gpu tournera en mode CPU"
    GPU_AVAILABLE=false
fi

# Adapter docker-compose si pas de GPU
if [ "$GPU_AVAILABLE" = false ]; then
    echo "[2/4] Désactivation GPU dans docker-compose..."
    # Commenter le bloc deploy.resources.reservations
    sed -i '/deploy:/,/capabilities: \[gpu\]/s/^/#/' docker-compose.yml
else
    echo "[2/4] GPU activé dans docker-compose ✓"
fi

# Créer le .env de production
echo "[3/4] Configuration des variables d'environnement..."
EXTERNAL_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "localhost")

cat > .env <<EOF
# ═══════════════════════════════════════
# VISTA — Production Configuration (GCP)
# Generated: $(date -Iseconds)
# ═══════════════════════════════════════

# PostgreSQL
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

# MinIO
MINIO_ACCESS_KEY=vistaadmin
MINIO_SECRET_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

# JWT
SECRET_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)

# API
API_RELOAD=false
LOG_LEVEL=info

# GPU
DEVICE=$( [ "$GPU_AVAILABLE" = true ] && echo "cuda" || echo "cpu" )

# External IP (auto-detected)
EXTERNAL_IP=${EXTERNAL_IP}
EOF

echo "  IP externe: ${EXTERNAL_IP}"

# Build et lancement
echo "[4/4] Build et démarrage des conteneurs..."
echo "  (première exécution : ~10-15 min pour télécharger les images Docker)"
echo ""

docker compose down 2>/dev/null || true
docker compose up -d --build

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  ✅  VISTA déployé avec succès !"
echo ""
echo "  🌐 Frontend :    http://${EXTERNAL_IP}:3000"
echo "  📡 API Swagger :  http://${EXTERNAL_IP}:8000/docs"
echo "  🗄️  MinIO Console: http://${EXTERNAL_IP}:9001"
echo "  ❤️  Health Check : http://${EXTERNAL_IP}:8000/health"
echo ""
echo "  Identifiants MinIO :"
echo "    User:     vistaadmin"
echo "    Password:  (voir .env)"
echo ""
echo "═══════════════════════════════════════════════════════════════"
DEPLOY_SCRIPT
)"

    # Récupérer l'IP externe
    EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --format="value(networkInterfaces[0].accessConfigs[0].natIP)" 2>/dev/null || echo "")

    echo ""
    log "═══════════════════════════════════════════════════════════════"
    log ""
    log "  🎉 Déploiement terminé !"
    log ""
    log "  🌐 Frontend :     http://${EXTERNAL_IP}:3000"
    log "  📡 API Swagger :  http://${EXTERNAL_IP}:8000/docs"
    log "  🗄️  MinIO :        http://${EXTERNAL_IP}:9001"
    log ""
    log "  SSH:  gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE}"
    log "  Logs: gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='cd /opt/vista && docker compose logs -f'"
    log "  Stop: gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='cd /opt/vista && docker compose down'"
    log ""
    log "═══════════════════════════════════════════════════════════════"
}

# ═══════════════════════════════════════════════════════════════════════════════
# COMMANDES UTILITAIRES
# ═══════════════════════════════════════════════════════════════════════════════
show_status() {
    log "Statut de VISTA sur ${INSTANCE_NAME}..."
    gcloud compute ssh $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --command="cd /opt/vista && docker compose ps && echo '' && docker compose logs --tail=5"
}

stop_vm() {
    log "Arrêt de la VM ${INSTANCE_NAME} (économie de coûts)..."
    gcloud compute instances stop $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE
    log "VM arrêtée ✓ (les données persistent)"
}

start_vm() {
    log "Démarrage de la VM ${INSTANCE_NAME}..."
    gcloud compute instances start $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE
    log "VM démarrée ✓"
    log "Attente (30s) puis relance des conteneurs..."
    sleep 30
    gcloud compute ssh $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --command="cd /opt/vista && docker compose up -d"

    EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE_NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
    log "VISTA accessible sur http://${EXTERNAL_IP}:3000"
}

estimate_cost() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  VISTA — Estimation des coûts GCP (mensuel)${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Machine n1-standard-8 :        ~\$195/mois"
    echo "  GPU NVIDIA T4 (1x) :           ~\$255/mois"
    echo "  Disque SSD 100 Go :            ~\$17/mois"
    echo "  IP statique :                  ~\$7/mois"
    echo "  ─────────────────────────────────────"
    echo "  Total (24/7) :                 ~\$474/mois"
    echo ""
    echo "  💡 Astuces pour réduire les coûts :"
    echo "  • Spot/Preemptible VM :        ~\$175/mois (-63%)"
    echo "  • Arrêter la VM la nuit :      ~\$237/mois (-50%)"
    echo "  • GPU L4 au lieu de T4 :       similaire mais plus performant"
    echo "  • Sans GPU (CPU only) :        ~\$195/mois"
    echo ""
}

show_help() {
    echo ""
    echo "Usage: ./deploy-gcp.sh [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  (none)     Déploiement complet (VM + setup + app)"
    echo "  --setup    Configure une VM existante (Docker + NVIDIA)"
    echo "  --app      Déploie l'app uniquement"
    echo "  --status   Statut des conteneurs"
    echo "  --stop     Arrêter la VM (économie)"
    echo "  --start    Redémarrer la VM + app"
    echo "  --cost     Estimation des coûts"
    echo "  --help     Aide"
    echo ""
    echo "Variables d'environnement :"
    echo "  GCP_PROJECT_ID   Projet GCP (défaut: projet courant)"
    echo "  GCP_ZONE         Zone (défaut: europe-west4-a)"
    echo "  GCP_INSTANCE     Nom VM (défaut: vista-server)"
    echo "  GCP_MACHINE_TYPE Machine (défaut: n1-standard-8)"
    echo "  GCP_GPU_TYPE     GPU (défaut: nvidia-tesla-t4)"
    echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
case "${1:-full}" in
    --setup)
        setup_vm
        ;;
    --app)
        deploy_app
        ;;
    --status)
        show_status
        ;;
    --stop)
        stop_vm
        ;;
    --start)
        start_vm
        ;;
    --cost)
        estimate_cost
        ;;
    --help|-h)
        show_help
        ;;
    full|*)
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  VISTA — Déploiement complet sur GCP${NC}"
        echo -e "${GREEN}  Projet: ${PROJECT_ID}${NC}"
        echo -e "${GREEN}  Zone:   ${ZONE}${NC}"
        echo -e "${GREEN}  VM:     ${INSTANCE_NAME} (${MACHINE_TYPE} + ${GPU_TYPE})${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
        echo ""
        estimate_cost
        echo ""
        read -p "Continuer le déploiement ? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            create_vm
            setup_vm
            echo ""
            warn "Reboot de la VM pour activer les drivers NVIDIA..."
            gcloud compute instances reset $INSTANCE_NAME --zone=$ZONE --project=$PROJECT_ID
            log "Attente du reboot (90s)..."
            sleep 90
            deploy_app
        else
            log "Annulé."
        fi
        ;;
esac
