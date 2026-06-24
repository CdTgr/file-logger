FROM node:24-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY ingest.js server.js watcher.js ./
COPY public/ public/

# logs/ is bind-mounted from the host at runtime
# data/ holds the SQLite DB and is a named volume for persistence
RUN mkdir -p /app/logs /app/data

ENV DB_PATH=/app/data/logs.db \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
