#!/bin/bash
# SessionStart hook — provisions the ShopStop backend dev environment so tests,
# linters, migrations, and the API can run in a fresh (or restarted) web session.
# Idempotent and non-interactive. Runs only in the remote (web) environment.
set -uo pipefail

# Only run in Claude Code on the web; local dev uses docker compose.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/user/ShopStop}"
API_DIR="$PROJECT_DIR/apps/api"
DB_URL="postgresql://shopstop:shopstop@localhost:5432/shopstop?schema=public"
REDIS_URL="redis://localhost:6379"

log() { echo "[session-start] $*"; }

# --- Postgres: start cluster + provision role/db (idempotent) ---------------
if command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pg_isready >/dev/null 2>&1 && break; sleep 1; done
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='shopstop'" 2>/dev/null | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE shopstop LOGIN PASSWORD 'shopstop' CREATEDB;" >/dev/null 2>&1 || true
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='shopstop'" 2>/dev/null | grep -q 1 \
    || sudo -u postgres createdb -O shopstop shopstop >/dev/null 2>&1 || true
  log "postgres ready"
else
  log "WARN: postgres not installed"
fi

# --- Redis ------------------------------------------------------------------
if ! redis-cli ping >/dev/null 2>&1; then
  redis-server --daemonize yes >/dev/null 2>&1 || true
  sleep 1
fi
redis-cli ping >/dev/null 2>&1 && log "redis ready" || log "WARN: redis unavailable"

# --- Root .env (gitignored; recreate from template if missing) --------------
if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$PROJECT_DIR/.env.example" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  log ".env created from template"
fi

# --- Dependencies (install is cache-friendly; skip if already present) ------
cd "$PROJECT_DIR" || exit 0
if command -v pnpm >/dev/null 2>&1; then
  if [ ! -d node_modules ] || [ ! -d apps/api/node_modules ]; then
    pnpm install --prefer-offline >/dev/null 2>&1 || pnpm install >/dev/null 2>&1 || true
  fi
  pnpm rebuild @prisma/client @prisma/engines prisma @swc/core argon2 >/dev/null 2>&1 || true
  log "dependencies installed"
fi

# --- Prisma: generate client + apply migrations + seed ----------------------
if [ -d "$API_DIR" ]; then
  cd "$API_DIR" || exit 0
  export DATABASE_URL="$DB_URL"
  pnpm exec prisma generate >/dev/null 2>&1 || true
  pnpm exec prisma migrate deploy >/dev/null 2>&1 || true
  NODE_ENV=development pnpm exec ts-node --transpile-only prisma/seed.ts >/dev/null 2>&1 || true
  log "prisma migrated + seeded"
fi

# --- Persist env vars for the session ---------------------------------------
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export DATABASE_URL=\"$DB_URL\""
    echo "export REDIS_URL=\"$REDIS_URL\""
  } >> "$CLAUDE_ENV_FILE"
fi

log "environment ready"
exit 0
