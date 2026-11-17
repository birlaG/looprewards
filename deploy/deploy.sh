#!/usr/bin/env bash
# Deploy / update:  ./deploy/deploy.sh   (run on the server, inside the project folder)
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${BRANCH:-main}"
[ -f .env ] || { echo "Missing .env  ->  cp .env.example .env  and edit it"; exit 1; }
git rev-parse HEAD > .previous_release 2>/dev/null || true
git fetch --quiet origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
if docker compose ps --status running 2>/dev/null | grep -q "db"; then ./deploy/backup.sh || echo "WARNING: pre-deploy backup failed"; fi
docker compose build
docker compose up -d --remove-orphans
echo "Waiting for the app to become healthy..."
for i in $(seq 1 40); do
  if docker compose exec -T web python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/healthz',timeout=3)" >/dev/null 2>&1; then
    echo "Deployed $(git rev-parse --short HEAD) OK"; docker image prune -f >/dev/null; exit 0
  fi
  sleep 3
done
echo "App did not become healthy. Last logs:"; docker compose logs --tail=60 web
echo "To go back to the previous version run:  ./deploy/rollback.sh"; exit 1
