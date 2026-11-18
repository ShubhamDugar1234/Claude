#!/bin/sh
# Restores the database from a backup made by backup.sh. THIS REPLACES ALL CURRENT DATA.
# Run on the server from the portal folder:  ./scripts/restore.sh backups/portal-20261118-210000.sql.gz
set -eu
cd "$(dirname "$0")/.."
FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: ./scripts/restore.sh backups/portal-<date>.sql.gz"
  exit 1
fi
printf "This will replace ALL data in the portal with %s. Type RESTORE to continue: " "$FILE"
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

docker compose stop app cron
docker compose exec -T db psql -U portal -d portal -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$FILE" | docker compose exec -T db psql -U portal -d portal -v ON_ERROR_STOP=1 -q
docker compose up -d
echo "Restored from $FILE."
