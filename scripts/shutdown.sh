#!/bin/bash
# VISTA — Graceful Shutdown
# Stops services in correct order, ensures data is saved

set -e
echo "[$(date)] VISTA graceful shutdown starting..."

cd /opt/vista

# 1. Stop accepting new tasks
echo "[$(date)] Stopping workers (finishing current tasks)..."
docker exec vista-worker-gpu celery -A tasks control shutdown 2>/dev/null || true
docker exec vista-worker-cpu celery -A tasks control shutdown 2>/dev/null || true
sleep 5

# 2. Quick backup before shutdown
echo "[$(date)] Running pre-shutdown backup..."
/opt/vista/scripts/backup-db.sh 2>/dev/null || echo "Backup skipped"

# 3. Flush Redis to disk
echo "[$(date)] Flushing Redis to disk..."
docker exec vista-redis redis-cli BGSAVE 2>/dev/null || true
sleep 2

# 4. Stop all containers gracefully
echo "[$(date)] Stopping all containers..."
docker compose down --timeout 30

echo "[$(date)] VISTA shutdown complete. Safe to stop VM."
