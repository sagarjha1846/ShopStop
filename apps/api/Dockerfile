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
  && pnpm --filter @shopstop/api --prod --legacy deploy /out

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

# Generate the Prisma client here, in the image that actually ships.
#
# `pnpm deploy` rebuilds /out/node_modules from the lockfile, which discards the
# client generated in the build stage and leaves a stock @prisma/client whose
# every export — including all the enums — is undefined. Nothing fails at build
# time; the container just dies on boot at the first decorator using a Prisma
# enum as a value.
#
# Generating from the build stage cannot fix it: Prisma resolves its output from
# the *schema's* directory, not the working directory, so pointing it at
# /repo/apps/api/prisma writes back into /repo however the cwd is set. Here the
# schema and the shipping node_modules are siblings under /app, so it lands in
# the right place. Runs before USER because node_modules is root-owned.
RUN ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma \
  # Prove it landed, so a regression fails the build instead of the deployment.
  # Any enum will do — they only exist when the client was genuinely generated.
  && node -e "const {CouponType}=require('@prisma/client'); if(!CouponType) throw new Error('Prisma client has no enums — generate did not reach the shipped node_modules'); console.log('prisma client ok:', Object.keys(CouponType).join(','))"

USER app
EXPOSE 4000
# Apply migrations then start (idempotent; safe to run each boot).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
