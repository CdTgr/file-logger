#!/bin/sh
set -e

echo "[entrypoint] Ingesting logs from ${LOGS_DIR:-/app/logs}..."
node dist/ingest.js

echo "[entrypoint] Starting server..."
exec node dist/server.js
