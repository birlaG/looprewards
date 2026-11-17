#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PREV=$(cat .previous_release)
git checkout "$PREV"
docker compose build && docker compose up -d
echo "Rolled back to $PREV. Database migrations are NOT undone: if a migration changed data, restore a backup (deploy/restore.sh)."
echo "To move forward again after fixing the code:  ./deploy/deploy.sh"
