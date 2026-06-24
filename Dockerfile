FROM node:24-alpine

WORKDIR /app

# Install dependencies (dev deps needed for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# logs/ is bind-mounted from the host at runtime
# data/ holds the SQLite DB and is a named volume for persistence
RUN mkdir -p /app/logs /app/data

ENV DB_PATH=/app/data/logs.db \
    LOGS_DIR=/app/logs \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
