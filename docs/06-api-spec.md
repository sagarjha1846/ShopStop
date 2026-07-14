# 06 — API Specification

Machine-readable contract: [`api/openapi.yaml`](../api/openapi.yaml) (OpenAPI 3.1). Served interactively at `/api/docs` (Swagger UI) generated from NestJS decorators + Zod schemas, so **code and docs never drift**.

## Conventions
- **REST first**, JSON only, base path **`/api/v1`**. GraphQL is an optional later addition for read-heavy aggregation, not MVP.
- **Versioning** in the path (`/v1`). Breaking changes → `/v2`; additive changes stay in `/v1`.
- **Auth:** `Authorization: Bearer <access JWT>` (short-lived, ~15 min). Refresh token is an **httpOnly, Secure, SameSite=Lax cookie**, rotated on `/auth/refresh`. Access tokens are never stored in `localStorage`.
- **Money:** always `{ amountMinor, currency }` integers; never floats, never rupee strings.
- **IDs:** opaque `cuid` strings.
- **Time:** ISO-8601 UTC.

## Pagination
- **Cursor-based** for feeds/search/messages (stable under inserts): `?cursor=&limit=` → `{ items, nextCursor }`. `limit` capped at 50.
- Offset pagination only for admin tables where total counts matter.

## Filtering & sorting
- Explicit query params (`categoryId`, `minPrice`, `condition`, `verifiedOnly`, `sort=recent|price_asc|price_desc|trending`). No arbitrary query DSL from clients (injection surface).

## Validation & errors
- Every request body validated with **Zod/class-validator** DTOs; unknown fields stripped.
- Uniform error envelope:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [...], "requestId": "req_…" } }
  ```
- Status codes: `400` malformed · `401` unauthenticated · `403` unauthorized (RBAC/ABAC) · `404` not found · `409` conflict / illegal state transition · `422` validation · `429` rate-limited (`Retry-After`) · `5xx` with `requestId` for correlation.

## Idempotency
- Mutating, money-adjacent, or retry-prone endpoints accept **`Idempotency-Key`** (required on `/orders`, `/payments/intent`; recommended on listing/message create). The key + response are cached (Redis, 24h) so retries are safe. Payment webhooks are idempotent via provider IDs + `Payment.idempotencyKey`.

## Rate limiting
- Global per-IP + per-user token buckets (Redis). Tighter buckets on auth (`/auth/login`, `/auth/otp/*`), listing create, and messaging to blunt spam/abuse. `429` returns `Retry-After`. See [11](11-security-architecture.md).

## Webhooks (inbound)
- `/payments/webhook/{provider}` verifies the provider **signature**, is **idempotent**, and does the minimum synchronously (record + enqueue) — heavy work runs in BullMQ.

## Realtime (not REST)
- **Socket.IO** namespace `/rt` authenticated via the same JWT. Events: `message:new`, `message:read`, `typing`, `presence`, `offer:update`, `notification:new`, `order:update`. REST remains the source of truth; sockets are a delivery channel.

## Surface overview (see YAML for full detail)

| Domain | Key endpoints |
|---|---|
| Auth | `POST /auth/register\|login\|refresh\|logout`, `POST /auth/otp/request\|verify`, OAuth callbacks |
| Users | `GET /me`, `GET /users/{handle}` (public trust panel) |
| Categories | `GET /categories` (tree + attribute schemas) |
| Listings | `GET/POST /listings`, `GET/PATCH/DELETE /listings/{id}`, `POST /listings/{id}/report`, `POST /media/upload-url` |
| Search | `GET /search`, `GET /search/autocomplete` |
| Messaging | `GET/POST /threads`, `GET/POST /threads/{id}/messages` (incl. offers) |
| Orders | `GET/POST /orders`, `POST /orders/{id}/transition`, `POST /orders/{id}/dispute` |
| Payments | `POST /payments/intent`, `POST /payments/webhook/{provider}` |
| Reviews | `POST /reviews` |
| Admin | `GET /admin/moderation/queue`, `POST /admin/moderation/{type}/{id}/action` |

## Contract testing
- OpenAPI is the source of truth; consumer (frontend) and provider (backend) are contract-tested in CI so a breaking change fails the build ([15](15-testing-strategy.md)).
