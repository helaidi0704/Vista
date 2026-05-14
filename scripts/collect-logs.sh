#!/bin/bash
# VISTA — Centralized log collection
# Collects logs from all containers into one file with timestamps
# Run hourly via cron or manually for debugging

LOG_DIR="/opt/vista/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/vista_${TIMESTAMP}.log"

echo "=== VISTA Log Collection — $(date) ===" > "$LOG_FILE"

for container in vista-db vista-redis vista-minio vista-api vista-worker-gpu vista-worker-cpu vista-mlflow vista-ui; do
    echo "" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════" >> "$LOG_FILE"
    echo "  ${container} — last 50 lines" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════" >> "$LOG_FILE"
    docker logs --tail=50 --timestamps "$container" >> "$LOG_FILE" 2>&1
done

# Keep only last 48 log files (2 days if hourly)
ls -t ${LOG_DIR}/vista_*.log 2>/dev/null | tail -n +49 | xargs rm -f 2>/dev/null

echo "[$(date)] Logs collected: $LOG_FILE ($(du -h "$LOG_FILE" | cut -f1))"
