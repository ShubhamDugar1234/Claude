# syntax=docker/dockerfile:1
# MV Dugar AI Portal. Three targets:
#   runner  - the small production web server (default)
#   tools   - runs database migrations and the seed (used once per deploy by docker-compose)
ARG NODE_VERSION=24.22.3

# 1. Install dependencies (this also generates the Prisma client).
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# 2. Build the app.
FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 3. Migrations and seed: has the full toolchain, runs once and exits.
FROM builder AS tools
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts"]

# 4. Production server: only the standalone build, run as a non-root user.
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
