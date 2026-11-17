#!/usr/bin/env bash
# Daily backup of Postgres + uploaded files. Keeps 14 days locally; copies offsite if RCLONE_REMOTE is set.
set -euo pipefail
cd "$(dirname "$0")/.."
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
DBU=$(get POSTGRES_USER); DBN=$(get POSTGRES_DB); REMOTE=$(get RCLONE_REMOTE || true)
D=backups; mkdir -p "$D"; TS=$(date +%F-%H%M)
docker compose exec -T db pg_dump -U "$DBU" -Fc "$DBN" > "$D/db-$TS.dump"
docker run --rm -v looprewards_media:/m:ro -v "$PWD/$D":/b alpine tar czf "/b/media-$TS.tgz" -C /m .
find "$D" -type f \( -name '*.dump' -o -name '*.tgz' \) -mtime +14 -delete
if [ -n "${REMOTE:-}" ] && command -v rclone >/dev/null; then rclone copy "$D" "$REMOTE" --max-age 2d; fi
echo "Backup $TS done ($(du -sh "$D" | cut -f1) total)"
