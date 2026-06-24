#!/bin/sh
set -e

echo "[entrypoint] Ingesting logs from /app/logs..."
node ingest.js

echo "[entrypoint] Starting server..."
exec node server.js
