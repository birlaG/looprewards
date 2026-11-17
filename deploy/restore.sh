#!/usr/bin/env bash
# Restore the database from a dump:  ./deploy/restore.sh backups/db-2026-12-01-0315.dump
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f "${1:-}" ] || { echo "Usage: $0 backups/db-....dump"; exit 1; }
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
read -r -p "This REPLACES the current database. Type YES to continue: " a; [ "$a" = YES ] || exit 1
docker compose stop web cron
docker compose exec -T db pg_restore -U "$(get POSTGRES_USER)" -d "$(get POSTGRES_DB)" --clean --if-exists --no-owner < "$1"
docker compose start web cron
echo "Restored. Uploaded files: tar xzf backups/media-....tgz into the media volume if needed (see GUIDE.md)."
