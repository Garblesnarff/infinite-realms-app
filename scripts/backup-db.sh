#!/bin/bash
# Database backup script for InfiniteRealms
# Runs inside supabase-db container

set -e

BACKUP_DIR="/var/www/infiniterealms/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/infiniterealms_$DATE.sql.gz"
RETENTION_DAYS=30

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Create backup
docker exec supabase-db pg_dump -U postgres postgres | gzip > "$BACKUP_FILE"

# Check if backup was successful
if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
    echo "Backup successful: $BACKUP_FILE"
    echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"
else
    echo "Backup failed!"
    exit 1
fi

# Delete backups older than retention period
find "$BACKUP_DIR" -name "infiniterealms_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "Cleaned up backups older than $RETENTION_DAYS days"
