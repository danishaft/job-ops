# syntax=docker/dockerfile:1.6

FROM --platform=$TARGETPLATFORM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    pkg-config \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared ./shared
COPY docs-site ./docs-site
COPY orchestrator ./orchestrator
COPY career-boards ./career-boards
COPY extractors ./extractors
COPY visa-sponsor-providers ./visa-sponsor-providers
COPY seed-data ./seed-data
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN npm ci --workspaces --include-workspace-root --include=dev --no-audit --no-fund --progress=false

WORKDIR /app/orchestrator
RUN npm run build:client

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.sh"]