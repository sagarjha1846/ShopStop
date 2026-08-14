#!/usr/bin/env bash
# Does a running ShopStop actually work? Drives a deployment through the paths
# most likely to be broken by deployment rather than by code.
#
#   ops/smoke.sh                          # defaults to a local stack
#   ops/smoke.sh https://shopstop.example # or your own deployment
#
# Read-only apart from registering one throwaway account, so it is safe to point
# at production. CI runs this against the freshly published images; run it
# yourself after a deploy rather than guessing from a green build.
set -euo pipefail

API="${1:-http://localhost:4000}"
WEB="${2:-http://localhost:3000}"
fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
ok() { echo "  ok — $1"; }

echo "api: $API"
echo "web: $WEB"

# Migrations ran and the schema serves. An empty catalogue is fine; a 5xx is not.
curl -sf "$API/api/v1/health/ready" >/dev/null || fail "API is not ready"
ok "health/ready"
curl -sf "$API/api/v1/categories" >/dev/null || fail "categories did not serve"
ok "categories (schema is migrated)"

# A real write, exercising Argon2 hashing, Postgres and Redis session storage
# together — the three things a fresh deployment most often has misconfigured.
EMAIL="smoke_$(date +%s)_$$@example.com"
TOKEN=$(curl -sf -X POST "$API/api/v1/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"smokepass12345\"}" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])') ||
  fail "register failed (DB writable? Redis reachable?)"
ok "register + token issue"

# The payables/payout SQL is hand-written and is the query most likely to break
# against a schema that migrated differently than expected.
curl -sf "$API/api/v1/me/payouts" -H "authorization: Bearer $TOKEN" |
  python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["heldMinor"]==0,d' ||
  fail "payout view broke"
ok "payout view (raw SQL runs)"

# Authorization is enforced by the running app, not only by the test suite.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/v1/admin/payables" \
  -H "authorization: Bearer $TOKEN")
[ "$CODE" = "403" ] || fail "admin payables returned $CODE for a normal user, expected 403"
ok "RBAC (admin route refuses a normal user)"

curl -sf -o /dev/null "$WEB/login" || fail "web did not serve /login"
ok "web serves"

# The browser reaches the API through the web origin, and next.config's rewrite is
# baked at build time — so this is what catches a web image built pointing at the
# wrong API host. Serving /login proves nothing: the page renders perfectly while
# every API call from it proxies into a void.
curl -sf -o /dev/null "$WEB/api/v1/categories" ||
  fail "web cannot reach the API through its own /api rewrite (API_BASE_URL baked wrong?)"
ok "web → API through the /api rewrite"

echo "smoke passed"
