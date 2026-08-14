# Multi-stage build for the ShopStop API (pnpm monorepo).
# Build context is the repo ROOT: `docker build -f apps/api/Dockerfile .`

# ---- deps + build -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Install with the full workspace manifest set (better layer caching).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @shopstop/api... --frozen-lockfile

# Build.
COPY tsconfig.base.json ./
COPY apps/api apps/api
# `--legacy` is required from pnpm v10: `deploy` now expects the workspace to set
# inject-workspace-packages=true, and errors out otherwise. This app has no
# workspace-package dependencies to inject, so the legacy (copy) behaviour is the
# one we actually want.
RUN pnpm --filter @shopstop/api exec prisma generate \
  && pnpm --filter @shopstop/api build \
  && pnpm --filter @shopstop/api --prod --legacy deploy /out \
  # `pnpm deploy` rebuilds node_modules in /out from the lockfile, which undoes the
  # generate above: the pruned bundle gets a stock @prisma/client whose exports are
  # all undefined. Nothing complains at build time — the image simply dies on boot
  # at the first decorator that uses a Prisma enum as a value. Generate again, into
  # the bundle that actually ships.
  && cd /out && ./node_modules/.bin/prisma generate --schema=/repo/apps/api/prisma/schema.prisma \
  # And prove it landed, so this fails the build rather than the deployment. Any
  # enum will do; it is only exported when the client was really generated.
  && node -e "const {CouponType}=require('/out/node_modules/@prisma/client'); if(!CouponType) throw new Error('Prisma client in /out has no enums — generate did not reach the pruned bundle'); console.log('prisma client ok:', Object.keys(CouponType).join(','))"

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 10001 app
WORKDIR /app
ENV NODE_ENV=production

# Pruned production bundle from `pnpm deploy` + built output + prisma assets.
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/package.json ./package.json

USER app
EXPOSE 4000
# Apply migrations then start (idempotent; safe to run each boot).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
