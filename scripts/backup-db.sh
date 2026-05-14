#!/bin/bash
# VISTA — Automated PostgreSQL Backup
# Dumps the database and uploads to MinIO for safe storage
# Run daily via cron: 0 3 * * * /opt/vista/scripts/backup-db.sh

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/vista_backup_${TIMESTAMP}.sql.gz"
MINIO_BUCKET="exports"
MINIO_KEY="backups/db/vista_backup_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting PostgreSQL backup..."

# Dump database (compressed)
docker exec vista-db pg_dump -U vista -d vista | gzip > "$BACKUP_FILE"
FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Dump created: $BACKUP_FILE ($FILESIZE)"

# Upload to MinIO
docker exec -i vista-minio mc alias set local http://localhost:9000 vistaadmin vistaSecretKey2024 2>/dev/null || true
docker cp "$BACKUP_FILE" vista-minio:/tmp/backup.sql.gz
docker exec vista-minio mc cp /tmp/backup.sql.gz local/${MINIO_BUCKET}/${MINIO_KEY} 2>/dev/null

if [ $? -eq 0 ]; then
    echo "[$(date)] Backup uploaded to MinIO: ${MINIO_BUCKET}/${MINIO_KEY}"
else
    echo "[$(date)] MinIO upload failed, keeping local copy"
fi

# Keep only last 7 local backups
ls -t /tmp/vista_backup_*.sql.gz 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null

# Delete backups older than 30 days in MinIO
docker exec vista-minio mc rm --older-than 30d local/${MINIO_BUCKET}/backups/db/ --recursive --force 2>/dev/null || true

echo "[$(date)] Backup complete: $BACKUP_FILE ($FILESIZE)"
