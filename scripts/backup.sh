#!/bin/sh
# Backs up the portal's database to backups/portal-<date>.sql.gz and keeps the newest 30.
# Run on the server from the portal folder:  ./scripts/backup.sh
# The backup contains everyone's chats: store copies somewhere private (see SECURITY.md).
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
FILE="backups/portal-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U portal -d portal --no-owner --no-privileges | gzip > "$FILE"
chmod 600 "$FILE"
ls -1t backups/portal-*.sql.gz | tail -n +31 | while read -r old; do rm -f -- "$old"; done
echo "Saved $FILE ($(du -h "$FILE" | cut -f1))"
