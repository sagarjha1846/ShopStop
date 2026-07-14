# 16 — Cost Estimation

Currency: USD (₹ ≈ figures in parentheses at ~₹83/$). These are **planning estimates** for a lean, cost-optimized setup — real bills vary with traffic and region. Rule enforced everywhere: every service justifies **why / monthly cost / scaling point / cheaper alternative**.

## Development cost (build the MVP)
Assumes a small team or solo founder + contractors. Ranges reflect solo-with-AI vs. small-team.

| Item | Effort | Cost range |
|---|---|---|
| Product/UX design | 3–4 wks | $0 (in-house) – $4k |
| Backend (NestJS + Prisma + payments + trust engine) | 8–12 wks | in-house – $15k |
| Frontend (Next.js) | 6–10 wks | in-house – $12k |
| DevOps/CI/security hardening | 2–3 wks | in-house – $4k |
| VAPT (third-party pentest) | one-off | $1.5k–$5k |
| Legal (policies, DPDP) | one-off | $500–$3k |
| **MVP total (solo + AI)** | ~3–4 months | **~$2k–$8k** out-of-pocket |
| **MVP total (small team)** | ~3–4 months | **~$40k–$60k** |

## Monthly infrastructure by scale tier

### Tier 0 — MVP / launch (≤ ~1K users): **~$25–45/mo**
| Service | Choice | ~$/mo | Why / cheaper alt |
|---|---|---|---|
| Compute | 1 VPS (2 vCPU / 4GB, DigitalOcean/Lightsail) runs api+web+worker+redis+postgres via Compose | 24 | Cheapest viable; alt: Hetzner (~$8) |
| Postgres | on-VPS (Compose) | $0 | Managed later; alt: Supabase free tier |
| Redis | on-VPS | $0 | Managed later |
| Object storage/CDN | S3 + CloudFront (low usage) | 1–5 | Alt: Cloudflare R2 (no egress) |
| Email | provider free tier (Resend/SES) | 0–1 | SES ~$0.10/1k |
| Domain/TLS | domain + Let's Encrypt | ~1 | TLS free |
| Monitoring | self-host Prometheus/Grafana on same box + free uptime | 0 | Grafana Cloud free tier |
| **Scaling point** | CPU/RAM contention, DB on same box as app | | move DB off-box next |

### Tier 1 — traction (~10K users): **~$80–150/mo**
- VPS bumped to 4 vCPU / 8GB (~$48) **or** split: app VPS + managed Postgres (DO managed ~$15–30).
- Redis stays on-box or small managed (~$15).
- S3+CloudFront grows with media (~$10–30).
- Sentry/Grafana Cloud free/low tiers (~$0–26).
- **Scaling point:** single DB write load, media egress; add read replica + CDN tuning.

### Tier 2 — growth (~100K users): **~$400–900/mo**
- 2–3 app instances behind proxy/load balancer (or move to **ECS Fargate**), autoscaling workers.
- **Managed Postgres** (multi-AZ, 4–8GB, ~$100–250) + read replica.
- **Managed Redis** (~$30–60).
- **OpenSearch** for search (~$80–200) — only when Postgres FTS relevance/latency caps out.
- S3+CloudFront (media-heavy, ~$50–150).
- Observability (Grafana Cloud/Datadog small, ~$50–150).
- **Scaling point:** DB write throughput, search, hot media → shard/partition, extract heavy modules.

### Tier 3 — scale (~1M users): **~$3k–8k+/mo**
- ECS/EKS, multiple services (search, media, notifications extracted), autoscaling.
- Managed Postgres (larger + replicas + partitioning), managed Redis cluster, OpenSearch cluster, CDN at volume, full observability + SIEM, WAF/DDoS (Cloudflare).
- **Scaling point:** per-service bottlenecks; see [17](17-scaling-roadmap.md).

## Cost per MAU (guardrail metric)
- Tier 0: ~$0.03/user/mo. Tier 2 (~100K): well under **$0.01/user/mo**. Target from [01](01-prd.md): **< ₹2/MAU**. The architecture stays comfortably inside this because the monolith avoids per-service overhead until traffic genuinely demands the split.

## Cost-optimization principles
1. **Open-source first** (Postgres, Redis, Prometheus/Grafana, NestJS) — no per-seat SaaS until it pays for itself.
2. **One box until it hurts.** Don't buy managed DB/Redis/search before a metric forces it.
3. **No Kubernetes / microservices early** — they're a cost multiplier (ops time + always-on infra).
4. **Egress is the silent killer** — CloudFront/R2 + image optimization; consider R2 (zero egress) if media-heavy.
5. **Free tiers deliberately** (Sentry, Grafana Cloud, email) at low scale.
6. **Autoscale workers, not always-on fleets.**
7. **Right-size + reserved/committed** compute once load is predictable (Tier 2+).

## Payment costs (pass-through, not infra)
Gateway fees ~2% (UPI often lower/free within limits) are transaction costs borne on GMV, not fixed infra — factor into take-rate/unit economics ([18](18-risks-and-tradeoffs.md)), not the monthly infra bill.
