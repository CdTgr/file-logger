FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable

# Backend deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Frontend deps
COPY frontend/package.json frontend/yarn.lock frontend/.yarnrc.yml ./frontend/
RUN cd frontend && yarn install --immutable

# Build backend
COPY tsconfig.json ./
COPY src/ src/
RUN yarn build

# Build frontend (output → frontend/dist/spa/)
COPY frontend/ frontend/
RUN cd frontend && yarn build

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist/spa ./src/public
COPY package.json ./

RUN mkdir -p /app/logs

ENV LOGS_DIR=/app/logs \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.js"]
