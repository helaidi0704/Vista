#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# VISTA — Déploiement GCP pour ai-use-cases-486914
# ═══════════════════════════════════════════════════════════════════════════════
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh              # Déploiement complet
#   ./deploy.sh setup        # Setup VM uniquement (Docker + NVIDIA)
#   ./deploy.sh app          # Déployer l'app uniquement
#   ./deploy.sh status       # Voir l'état
#   ./deploy.sh logs         # Suivre les logs
#   ./deploy.sh stop         # Arrêter la VM (économie)
#   ./deploy.sh start        # Relancer la VM
#   ./deploy.sh ssh          # Se connecter en SSH
#   ./deploy.sh destroy      # Supprimer la VM
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
PROJECT_ID="ai-use-cases-486914"
ZONE="europe-west4-a"
INSTANCE="vista-server"
MACHINE_TYPE="n1-standard-8"       # 8 vCPU, 30 Go RAM
GPU_TYPE="nvidia-tesla-t4"
GPU_COUNT="1"
DISK_SIZE="100"                    # Go SSD
IMAGE_FAMILY="ubuntu-2204-lts"
IMAGE_PROJECT="ubuntu-os-cloud"

# Couleurs
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m' N='\033[0m'
log()  { echo -e "${G}[VISTA]${N} $1"; }
warn() { echo -e "${Y}[WARN]${N} $1"; }
err()  { echo -e "${R}[ERROR]${N} $1"; exit 1; }

# Vérifier gcloud
command -v gcloud >/dev/null 2>&1 || err "gcloud CLI non trouvé. Installez-le: https://cloud.google.com/sdk/docs/install"

# Vérifier le projet
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    log "Configuration du projet GCP..."
    gcloud config set project $PROJECT_ID
fi

get_ip() {
    gcloud compute instances describe $INSTANCE \
        --project=$PROJECT_ID --zone=$ZONE \
        --format="value(networkInterfaces[0].accessConfigs[0].natIP)" 2>/dev/null || echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 1 — Créer la VM GCP avec GPU
# ═══════════════════════════════════════════════════════════════════════════════
create_vm() {
    log "Vérification si la VM existe déjà..."
    if gcloud compute instances describe $INSTANCE --zone=$ZONE --project=$PROJECT_ID &>/dev/null; then
        warn "La VM '$INSTANCE' existe déjà."
        read -p "Continuer avec la VM existante ? (y/N) " -n 1 -r; echo
        [[ $REPLY =~ ^[Yy]$ ]] || exit 0
        return 0
    fi

    log "Création de la VM..."
    log "  Projet:  $PROJECT_ID"
    log "  Zone:    $ZONE"
    log "  Machine: $MACHINE_TYPE + ${GPU_COUNT}x $GPU_TYPE"
    log "  Disque:  ${DISK_SIZE}Go SSD"

    gcloud compute instances create $INSTANCE \
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
        --tags=vista-server,http-server,https-server \
        --scopes=default,storage-ro \
        --metadata=startup-script='#!/bin/bash
            echo "VISTA VM started" >> /var/log/vista.log'

    log "VM créée ✓"

    # Firewall
    log "Configuration firewall..."
    gcloud compute firewall-rules create vista-ports \
        --project=$PROJECT_ID \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:3000,tcp:8000,tcp:5000,tcp:9000,tcp:9001 \
        --target-tags=vista-server \
        --source-ranges=0.0.0.0/0 \
        --description="VISTA: UI(3000), API(8000), MinIO(9000/9001)" \
        2>/dev/null || warn "Règle firewall existe déjà"

    log "Attente du démarrage (30s)..."
    sleep 30
}

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 2 — Installer Docker + NVIDIA Container Toolkit
# ═══════════════════════════════════════════════════════════════════════════════
setup_vm() {
    log "Installation Docker + NVIDIA sur la VM..."

    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE --command='bash -s' <<'SETUP'
set -euo pipefail
echo "══════════════════════════════════════"
echo "  VISTA — Setup VM"
echo "══════════════════════════════════════"

# 1. Système
echo "[1/5] Mise à jour..."
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release git jq

# 2. Docker
echo "[2/5] Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker installé ✓"
else
    echo "Docker déjà présent ✓"
fi

# 3. NVIDIA drivers
echo "[3/5] NVIDIA drivers..."
if ! command -v nvidia-smi &>/dev/null; then
    sudo apt-get install -y -qq linux-headers-$(uname -r)
    sudo apt-get install -y -qq nvidia-driver-535 nvidia-utils-535
    NEEDS_REBOOT=true
    echo "Drivers installés — reboot nécessaire"
else
    echo "NVIDIA drivers OK ✓"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    NEEDS_REBOOT=false
fi

# 4. NVIDIA Container Toolkit
echo "[4/5] NVIDIA Container Toolkit..."
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
    echo "NVIDIA Toolkit installé ✓"
else
    echo "NVIDIA Toolkit déjà présent ✓"
fi

# 5. Préparation
echo "[5/5] Préparation..."
sudo mkdir -p /opt/vista
sudo chown $USER:$USER /opt/vista
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "══════════════════════════════════════"
echo "  Setup terminé ✓"
if [ "${NEEDS_REBOOT:-false}" = true ]; then
    echo "  ⚠️  REBOOT NÉCESSAIRE pour NVIDIA"
fi
echo "══════════════════════════════════════"
SETUP

    log "Setup VM terminé ✓"
}

# ═══════════════════════════════════════════════════════════════════════════════
# ÉTAPE 3 — Déployer l'application
# ═══════════════════════════════════════════════════════════════════════════════
deploy_app() {
    log "Déploiement de VISTA..."

    # Vérifier que le fichier source existe
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ ! -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        err "docker-compose.yml non trouvé dans $SCRIPT_DIR"
    fi

    # Créer une archive propre du projet
    log "Préparation de l'archive..."
    cd "$SCRIPT_DIR"
    tar --exclude='node_modules' --exclude='.next' --exclude='__pycache__' \
        --exclude='.git' --exclude='*.pyc' \
        -czf /tmp/vista-deploy.tar.gz -C "$(dirname "$SCRIPT_DIR")" "$(basename "$SCRIPT_DIR")"

    # Upload
    log "Upload vers la VM (~30s)..."
    gcloud compute scp /tmp/vista-deploy.tar.gz $INSTANCE:/tmp/ \
        --project=$PROJECT_ID --zone=$ZONE

    rm -f /tmp/vista-deploy.tar.gz

    # Déployer sur la VM
    log "Déploiement sur la VM..."
    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE --command='bash -s' <<'DEPLOY'
set -euo pipefail
echo "══════════════════════════════════════"
echo "  VISTA — Déploiement Application"
echo "══════════════════════════════════════"

# Extraire
cd /opt/vista
rm -rf backend frontend worker-gpu worker-cpu nginx scripts 2>/dev/null || true
tar -xzf /tmp/vista-deploy.tar.gz --strip-components=1
rm -f /tmp/vista-deploy.tar.gz

# Détecter GPU
echo "[1/4] Détection GPU..."
if nvidia-smi &>/dev/null; then
    echo "  GPU détecté:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    GPU_OK=true
else
    echo "  ⚠️ Pas de GPU — mode CPU"
    GPU_OK=false
fi

# Adapter docker-compose si pas de GPU
if [ "$GPU_OK" = false ]; then
    echo "[2/4] Désactivation GPU dans docker-compose..."
    sed -i '/deploy:/,/capabilities: \[gpu\]/s/^/#/' docker-compose.yml
else
    echo "[2/4] GPU activé ✓"
fi

# Générer .env de production
echo "[3/4] Génération des secrets..."
EXTERNAL_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "localhost")

cat > .env <<ENVEOF
# VISTA — Production (GCP)
# Généré le $(date -Iseconds)

POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
MINIO_ACCESS_KEY=vistaadmin
MINIO_SECRET_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
SECRET_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
API_RELOAD=false
LOG_LEVEL=info
DEVICE=$( [ "$GPU_OK" = true ] && echo "cuda" || echo "cpu" )
EXTERNAL_IP=${EXTERNAL_IP}
ENVEOF

# Patcher le frontend pour utiliser l'IP externe
sed -i "s|NEXT_PUBLIC_API_URL:.*|NEXT_PUBLIC_API_URL: http://${EXTERNAL_IP}:8000|" docker-compose.yml
sed -i "s|NEXT_PUBLIC_WS_URL:.*|NEXT_PUBLIC_WS_URL: ws://${EXTERNAL_IP}:8000|" docker-compose.yml
sed -i "s|NEXT_PUBLIC_MINIO_URL:.*|NEXT_PUBLIC_MINIO_URL: http://${EXTERNAL_IP}:9000|" docker-compose.yml

# Fix: s'assurer que le frontend a un package-lock.json
if [ ! -f frontend/package-lock.json ]; then
    echo "  Génération de package-lock.json..."
    cd frontend
    # Remplacer npm ci par npm install dans le Dockerfile (pas de lockfile)
    sed -i 's/npm ci --prefer-offline/npm install/' Dockerfile
    cd ..
fi

# Fix: enlever le --reload en prod dans le backend
sed -i 's/--reload//' backend/Dockerfile

# Build et lancement
echo "[4/4] Build des conteneurs (première fois : ~10-15 min)..."
docker compose down 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -20

# Attendre que les services démarrent
echo ""
echo "Attente des health checks (60s)..."
sleep 60

# Vérifier
echo ""
echo "Statut des conteneurs:"
docker compose ps
echo ""
HEALTH=$(curl -s http://localhost:8000/health 2>/dev/null || echo '{"status":"starting"}')
echo "API Health: $HEALTH"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  ✅  VISTA déployé avec succès !"
echo ""
echo "  🌐 Frontend :     http://${EXTERNAL_IP}:3000"
echo "  📡 API Swagger :  http://${EXTERNAL_IP}:8000/docs"
echo "  🗄️  MinIO Console: http://${EXTERNAL_IP}:9001"
echo "  ❤️  Health Check : http://${EXTERNAL_IP}:8000/health"
echo ""
echo "  Credentials MinIO :"
echo "    User:     vistaadmin"
echo "    Password: $(grep MINIO_SECRET_KEY .env | cut -d= -f2)"
echo ""
echo "══════════════════════════════════════════════════════════════"
DEPLOY

    EXTERNAL_IP=$(get_ip)
    echo ""
    log "══════════════════════════════════════════════════════════════"
    log ""
    log "  🎉 Déploiement terminé !"
    log ""
    log "  🌐 Frontend :     http://${EXTERNAL_IP}:3000"
    log "  📡 API Swagger :  http://${EXTERNAL_IP}:8000/docs"
    log "  🗄️  MinIO Console: http://${EXTERNAL_IP}:9001"
    log ""
    log "══════════════════════════════════════════════════════════════"
}

# ═══════════════════════════════════════════════════════════════════════════════
# COMMANDES UTILITAIRES
# ═══════════════════════════════════════════════════════════════════════════════
do_status() {
    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE \
        --command="cd /opt/vista && docker compose ps && echo '' && curl -s http://localhost:8000/health 2>/dev/null | jq . || echo 'API pas encore prête'"
}

do_logs() {
    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE \
        --command="cd /opt/vista && docker compose logs -f --tail=50 ${2:-}"
}

do_stop() {
    log "Arrêt de la VM (les données persistent)..."
    gcloud compute instances stop $INSTANCE --project=$PROJECT_ID --zone=$ZONE
    log "VM arrêtée ✓ — relancer avec: ./deploy.sh start"
}

do_start() {
    log "Démarrage de la VM..."
    gcloud compute instances start $INSTANCE --project=$PROJECT_ID --zone=$ZONE
    log "Attente (45s)..."
    sleep 45
    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE \
        --command="cd /opt/vista && docker compose up -d"
    EXTERNAL_IP=$(get_ip)
    log "VISTA accessible: http://${EXTERNAL_IP}:3000"
}

do_ssh() {
    gcloud compute ssh $INSTANCE --project=$PROJECT_ID --zone=$ZONE
}

do_destroy() {
    warn "Cela va SUPPRIMER la VM et toutes les données !"
    read -p "Confirmer la suppression ? (tapez 'DELETE') " confirm
    if [ "$confirm" = "DELETE" ]; then
        gcloud compute instances delete $INSTANCE --project=$PROJECT_ID --zone=$ZONE --quiet
        gcloud compute firewall-rules delete vista-ports --project=$PROJECT_ID --quiet 2>/dev/null || true
        log "VM et ressources supprimées ✓"
    else
        log "Annulé."
    fi
}

do_cost() {
    echo ""
    echo -e "${B}  VISTA — Estimation des coûts GCP (mensuel)${N}"
    echo ""
    echo "  n1-standard-8 (8 vCPU, 30 Go) :  ~195 $/mois"
    echo "  GPU NVIDIA T4 (1x) :              ~255 $/mois"
    echo "  Disque SSD 100 Go :               ~17 $/mois"
    echo "  ─────────────────────────────────────"
    echo "  Total (24/7) :                    ~467 $/mois"
    echo ""
    echo "  💡 Arrêter la nuit : ./deploy.sh stop → ~234 $/mois"
    echo ""
}

# ─── MAIN ─────────────────────────────────────────────────────────────────────
case "${1:-full}" in
    setup)   setup_vm ;;
    app)     deploy_app ;;
    status)  do_status ;;
    logs)    do_logs "$@" ;;
    stop)    do_stop ;;
    start)   do_start ;;
    ssh)     do_ssh ;;
    destroy) do_destroy ;;
    cost)    do_cost ;;
    full|*)
        echo ""
        log "══════════════════════════════════════════════════════════════"
        log "  VISTA — Déploiement complet sur GCP"
        log "  Projet:  $PROJECT_ID"
        log "  Compte:  houssem.elaidi@gmail.com"
        log "  Zone:    $ZONE"
        log "  VM:      $INSTANCE ($MACHINE_TYPE + $GPU_TYPE)"
        log "══════════════════════════════════════════════════════════════"
        do_cost
        read -p "Lancer le déploiement ? (y/N) " -n 1 -r; echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            create_vm
            setup_vm
            echo ""
            warn "Reboot de la VM pour activer les drivers NVIDIA..."
            gcloud compute instances reset $INSTANCE --zone=$ZONE --project=$PROJECT_ID
            log "Attente du reboot (90s)..."
            sleep 90
            deploy_app
        fi
        ;;
esac
