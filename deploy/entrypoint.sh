#!/bin/sh
set -e
if ! ls core/migrations/0001_*.py >/dev/null 2>&1; then
  echo "ERROR: core/migrations is missing. On your laptop run 'make migrations-local', commit core/migrations, push, redeploy."
  exit 1
fi
python manage.py migrate --noinput
exec gunicorn config.wsgi -b 0.0.0.0:8000 -w "${WEB_WORKERS:-4}" -k gthread --threads 4 \
  --timeout 60 --max-requests 2000 --max-requests-jitter 200 --access-logfile - --error-logfile -
