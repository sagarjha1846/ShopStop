# 13 — DevOps, CI/CD & Deployment

Guiding constraint: **low cost, small team, no Kubernetes initially.** One VPS + Docker Compose gets us to ~10K–50K users; ECS is the next step, not the first.

## Environments
| Env | Purpose | Infra |
|---|---|---|
| **local** | dev | Docker Compose (api, web, postgres, redis, mailhog, minio) |
| **staging** | pre-prod, DAST target | same compose on a small VPS; seeded data |
| **production** | live | single VPS (Compose) → ECS later |

## Local / single-VPS topology (Docker Compose)
```
services:
  web       (Next.js)          :3000
  api       (NestJS + worker)  :4000        # worker can be same image, WORKER=1
  postgres  (16, volume)       :5432
  redis     (7, volume)        :6379
  proxy     (Traefik/Nginx)    :80/443      # TLS (Let's Encrypt), headers, rate limit
  minio     (S3-compatible, local only)
  mailhog   (email, local only)
```
Prod swaps MinIO→S3, MailHog→email provider, and uses managed Postgres if/when the bill justifies it. Compose files: `docker-compose.yml` (base) + `docker-compose.prod.yml` (overrides).

## CI/CD — GitHub Actions
**PR pipeline (`ci.yml`):**
1. Install (cached) → typecheck → lint → format check.
2. Unit + integration tests (Postgres/Redis service containers) with coverage gate.
3. **Security:** CodeQL/Semgrep (SAST), `npm audit`/Snyk (deps), secret scan, Trivy (image).
4. Prisma `migrate diff` check (no drift) + build.
5. Playwright E2E against an ephemeral compose stack (smoke suite).

**Main pipeline (`deploy.yml`):**
1. Build + push Docker images (tagged by SHA) to registry (GHCR).
2. Run DB migrations (`prisma migrate deploy`) as a gated step.
3. Deploy: SSH/`docker compose pull && up -d` (VPS) or `ecs deploy` (later).
4. Post-deploy `/health/ready` smoke check → auto-rollback to previous tag on failure.

Branch protection: PRs require green CI + review; no direct pushes to `main`. Feature branches → PR → squash-merge.

## Migrations
- **Prisma Migrate**, forward-only in prod (`migrate deploy`). Expand-then-contract for zero-downtime schema changes (add column/backfill/switch/drop across releases). Migrations run as a discrete, logged CI step before app rollout.

## Deployment strategy
- **MVP (single VPS):** `docker compose up -d` with health-gated rollout; brief tolerable blips acceptable at this scale; auto-rollback on failed healthcheck.
- **Zero-downtime path:** run 2 api replicas behind the proxy, rolling restart, drain connections (graceful shutdown in [07](07-backend-architecture.md)).
- **ECS phase:** rolling/blue-green via CodeDeploy; same images, same migrations discipline.

## Backups & disaster recovery
- **Postgres:** daily encrypted full dump + **WAL archiving/PITR**; retain 7 daily / 4 weekly; **offsite copy** (S3, different region/account).
- **Object storage:** S3 versioning + lifecycle; cross-region replication when budget allows.
- **Restore drills:** documented, tested quarterly. **RPO ≤ 15 min** (WAL), **RTO ≤ 2 h** (restore + redeploy).
- **Config/secrets:** in secrets manager, reproducible; infra-as-code (Compose files + minimal Terraform for cloud bits) in the repo.

## Secrets & config
- Secrets from a manager (Doppler/SSM/Secrets Manager) injected as env at deploy; never in the image or repo. JWT signing keys support rotation (key-id). Per-env `.env` validated at boot.

## Runbooks (in repo `/ops`)
- Deploy / rollback, DB restore, rotate secrets, scale up, incident response, on-call escalation. Keep them boring and tested.

## Cost discipline
Every added managed service must state **why / monthly cost / scaling point / cheaper alternative** ([16](16-cost-estimation.md)). Default answer to "do we need Kubernetes/OpenSearch/microservices yet?" is **no** until a metric forces it ([17](17-scaling-roadmap.md)).
