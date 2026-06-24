FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json ./
COPY src/ src/
RUN yarn build

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY src/views src/views
COPY src/public src/public
COPY package.json ./

RUN mkdir -p /app/logs

ENV LOGS_DIR=/app/logs \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.js"]
