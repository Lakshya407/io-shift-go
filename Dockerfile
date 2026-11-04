# syntax=docker/dockerfile:1.7
#
# ShiftGo cab app: self-hosted Node.js build (same target as AWS EC2, see docs/DEPLOY-AWS.md).
#   - `npm run build:node` emits a self-contained server in dist/standalone
#     (server.js + dist/ + the pruned runtime node_modules it needs).
#   - Cloudflare bindings are replaced by lib/node-runtime.ts: SQLite file via
#     node:sqlite (Node >= 22.13) and configuration from environment variables.
#   - Migrations and the every-minute maintenance tick (SOS escalation, daily
#     reports) run inside the app once the database is first opened.
#
# Build:   docker build -t shiftgo-cab .
# Test:    docker build --target test .
# Run:     docker run -p 3000:3000 -v shiftgo-data:/data -e SETUP_TOKEN=... shiftgo-cab

ARG NODE_VERSION=22

# ---------- 1. dependencies (cached until package*.json changes) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /src
ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --include=optional --no-audit --no-fund

# ---------- 2. build the standalone Node server ----------
FROM deps AS build
ENV NODE_OPTIONS=--max-old-space-size=3072     NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN node -e "require('node:sqlite')"  && npm run build:node  && test -f dist/standalone/server.js  && mkdir -p /out/data

# ---------- 3. optional: typecheck + tests (docker build --target test .) ----------
FROM build AS test
RUN npm run typecheck && npm test

# ---------- 4. runtime image ----------
# Distroless Node.js (Debian 13): node only, no shell / package manager / OS tools, which removes
# most OS CVEs that Trivy reports for the full Debian images. Runs as "nonroot" (uid/gid 65532).
# Its entrypoint is already the node binary, so CMD/HEALTHCHECK pass node arguments.
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13:nonroot AS runtime
LABEL org.opencontainers.image.title="shiftgo-cab"       org.opencontainers.image.description="ShiftGo night-shift cab safety app (self-hosted Node.js + PostgreSQL/SQLite)"

ENV NODE_ENV=production     HOST=0.0.0.0     PORT=3000     DATABASE_PATH=/data/shiftgo.db     NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# App files stay root-owned (read-only for the app user). /data is only used by the SQLite
# fallback (no DATABASE_URL); with PostgreSQL nothing in the container is written.
COPY --from=build /src/dist/standalone/ ./
COPY --from=build --chown=65532:65532 /out/data /data

USER 65532:65532
VOLUME ["/data"]
EXPOSE 3000

# /api/health opens the database (applying migrations) and answers {"ok":true}.
# Because it runs right after start, it also acts as the warm-up that starts
# the maintenance tick even before anyone uses the app.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1),()=>process.exit(1))"]

CMD ["server.js"]
