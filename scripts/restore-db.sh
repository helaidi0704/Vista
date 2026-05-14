#!/bin/bash
# VISTA — Restore PostgreSQL from backup
# Usage: ./restore-db.sh /tmp/vista_backup_20260513.sql.gz

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.sql.gz>"
    echo "Available backups:"
    ls -lt /tmp/vista_backup_*.sql.gz 2>/dev/null || echo "  No local backups found"
    exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: File not found: $BACKUP_FILE"
    exit 1
fi

echo "[$(date)] WARNING: This will overwrite the current database!"
read -p "Continue? (y/N): " confirm
if [ "$confirm" != "y" ]; then
    echo "Cancelled."
    exit 0
fi

echo "[$(date)] Stopping API and workers..."
cd /opt/vista
docker compose stop api worker-gpu worker-cpu

echo "[$(date)] Restoring database from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | docker exec -i vista-db psql -U vista -d vista

echo "[$(date)] Restarting services..."
docker compose up -d api worker-gpu worker-cpu

echo "[$(date)] Restore complete!"
