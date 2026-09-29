#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U vte -d vte -f /demo/reset.sql
docker compose exec -T db pg_restore --data-only --disable-triggers -U vte -d vte /demo/snapshot.dump
echo "Demo DB restored. Refresh every browser window."
