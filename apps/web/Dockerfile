# Multi-stage build for the ShopStop web app (Next.js standalone).
# Build context is the repo ROOT: `docker build -f apps/web/Dockerfile .`

# ---- deps + build -----------------------------------------------------------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @shopstop/web... --frozen-lockfile

COPY apps/web apps/web
# API origin used for SSR rewrites/fetches; override at build/runtime.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @shopstop/web build

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN useradd -m -u 10001 app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000

# Next standalone output bundles a minimal server + only the deps it needs.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
