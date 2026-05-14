#!/bin/bash
# VISTA — Startup with health verification
# Starts all services and verifies they're healthy

set -e
echo "[$(date)] VISTA startup beginning..."

cd /opt/vista

# Update external IP automatically
EXTERNAL_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google")
echo "[$(date)] External IP: $EXTERNAL_IP"

sed -i "s/EXTERNAL_IP: .*/EXTERNAL_IP: $EXTERNAL_IP/g" docker-compose.yml
sed -i "s/EXTERNAL_IP=.*/EXTERNAL_IP=$EXTERNAL_IP/" .env
sed -i "s|NEXT_PUBLIC_API_URL: .*|NEXT_PUBLIC_API_URL: http://$EXTERNAL_IP:8000|" docker-compose.yml

# Start all services
echo "[$(date)] Starting containers..."
docker compose up -d

# Wait for health checks
echo "[$(date)] Waiting for services to be healthy..."
sleep 15

# Verify each service
HEALTHY=true
for svc in vista-db vista-redis vista-minio vista-api; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' $svc 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "healthy" ]; then
        echo "  ✅ $svc: $STATUS"
    else
        echo "  ❌ $svc: $STATUS"
        HEALTHY=false
    fi
done

for svc in vista-worker-gpu vista-worker-cpu vista-mlflow vista-ui; do
    RUNNING=$(docker inspect --format='{{.State.Status}}' $svc 2>/dev/null || echo "unknown")
    if [ "$RUNNING" = "running" ]; then
        echo "  ✅ $svc: $RUNNING"
    else
        echo "  ❌ $svc: $RUNNING"
        HEALTHY=false
    fi
done

if [ "$HEALTHY" = true ]; then
    echo ""
    echo "[$(date)] ✅ VISTA is ready!"
    echo "  UI:      http://$EXTERNAL_IP:3000"
    echo "  API:     http://$EXTERNAL_IP:8000/docs"
    echo "  MLflow:  http://$EXTERNAL_IP:5000"
    echo "  MinIO:   http://$EXTERNAL_IP:9001"
else
    echo ""
    echo "[$(date)] ⚠️  Some services are not healthy. Check: docker compose ps"
fi
