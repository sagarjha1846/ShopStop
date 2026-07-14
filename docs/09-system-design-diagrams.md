# 09 — System Design Diagrams

All diagrams are Mermaid (render on GitHub). They cover the flows requested: high-level architecture, auth, listing lifecycle, purchase, payment, notification, chat, media upload, fraud detection, moderation.

## 1. High-level architecture
```mermaid
flowchart LR
  U[Browser / PWA<br/>Next.js] -->|HTTPS| CDN[CloudFront CDN]
  U -->|REST /api/v1| API[NestJS modular monolith]
  U -->|wss /rt| API
  CDN --> S3[(S3 media)]
  subgraph VPS[Single VPS · Docker Compose]
    API --> PG[(PostgreSQL 16<br/>data + FTS)]
    API --> REDIS[(Redis<br/>cache/rate-limit/queue)]
    API --> WK[BullMQ workers]
    WK --> PG
    WK --> REDIS
  end
  API -->|signed URLs| S3
  API -->|webhooks| PAY[Payment gateways<br/>Razorpay/Cashfree/PhonePe]
  PAY -->|webhook| API
  WK --> MAIL[Email/SMS providers]
  API --> OBS[Logs/Metrics/Traces]
```

## 2. Authentication flow (login + refresh rotation)
```mermaid
sequenceDiagram
  participant C as Client
  participant API as Auth module
  participant DB as Postgres
  participant R as Risk engine
  C->>API: POST /auth/login (email, pwd)
  API->>DB: verify Argon2id hash
  API->>R: score login (ip, device, geo)
  R-->>API: risk verdict
  alt MFA enabled or high risk
    API-->>C: 200 { mfaRequired:true }
    C->>API: POST /auth/login (mfaCode)
  end
  API->>DB: create Session (hash of refresh)
  API-->>C: access JWT (15m) + refresh cookie (httpOnly)
  Note over C,API: later…
  C->>API: POST /auth/refresh (cookie)
  API->>DB: lookup+rotate; reuse? revoke family
  API-->>C: new access JWT + new refresh cookie
```

## 3. Listing lifecycle
```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> PENDING_REVIEW: publish (risk: medium/high)
  DRAFT --> ACTIVE: publish (risk: low)
  PENDING_REVIEW --> ACTIVE: admin approve
  PENDING_REVIEW --> REJECTED: admin reject
  ACTIVE --> PAUSED: seller pause
  PAUSED --> ACTIVE: seller resume
  ACTIVE --> SOLD: order completed
  ACTIVE --> REMOVED: moderation takedown
  ACTIVE --> ARCHIVED: seller archive
  REJECTED --> [*]
  ARCHIVED --> [*]
```

## 4. Purchase lifecycle (order state machine)
```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> ACCEPTED: seller accepts / payment captured
  PENDING --> REJECTED: seller rejects
  PENDING --> CANCELLED: buyer cancels
  ACCEPTED --> PACKED
  PACKED --> SHIPPED
  SHIPPED --> DELIVERED
  DELIVERED --> RETURNED: buyer returns
  RETURNED --> REFUNDED
  ACCEPTED --> CANCELLED
  REFUNDED --> [*]
  DELIVERED --> [*]
```

## 5. Payment flow (webhook-driven, idempotent)
```mermaid
sequenceDiagram
  participant C as Buyer
  participant API
  participant PAY as Gateway (Razorpay)
  participant DB
  C->>API: POST /payments/intent (orderId, Idempotency-Key)
  API->>PAY: create order/intent (amountMinor)
  PAY-->>API: providerOrderId + clientToken
  API->>DB: Payment(status=CREATED, idempotencyKey)
  API-->>C: clientToken
  C->>PAY: complete payment (UPI/card…)
  PAY-->>API: webhook (signed) payment.captured
  API->>API: verify signature + idempotency
  API->>DB: Payment=CAPTURED, Transaction(CHARGE), Order=ACCEPTED
  API-->>PAY: 200 ack
  API->>C: realtime order:update
```

## 6. Notification flow
```mermaid
flowchart LR
  EV[Domain event<br/>order.paid / message.new / offer.received] --> Q[BullMQ notify queue]
  Q --> PREF{User prefs +<br/>consent}
  PREF -->|in-app| N[(Notification row)] --> WS[Socket.IO push]
  PREF -->|email| MAIL[Email provider]
  PREF -->|push P2| FCM[Web/FCM push]
  PREF -->|sms P2| SMS[SMS provider]
```

## 7. Chat architecture
```mermaid
flowchart LR
  subgraph Clients
    A[Buyer] ; B[Seller]
  end
  A <-->|wss /rt JWT| GW[Socket.IO gateway]
  B <-->|wss /rt JWT| GW
  GW <--> RADP[(Redis adapter<br/>multi-instance fanout)]
  GW --> SVC[Messaging service]
  SVC --> DB[(messages / threads)]
  SVC --> MQ[risk queue: moderate media/text]
  SVC --> NQ[notify queue: offline recipients]
  Note over GW,SVC: REST is source of truth;<br/>sockets deliver typing/read/presence/offers
```

## 8. Media upload flow (direct-to-S3 + async scan)
```mermaid
sequenceDiagram
  participant C as Client
  participant API
  participant S3
  participant WK as media-scan worker
  C->>API: POST /media/upload-url (contentType, size)
  API-->>C: signed PUT url + storageKey (validated type/size)
  C->>S3: PUT file directly (signed)
  C->>API: attach storageKey to listing (scanStatus=PENDING)
  S3-->>WK: event / enqueue
  WK->>WK: virus + NSFW + illegal-image scan, derivatives
  WK->>API: set scanStatus=CLEAN | FLAGGED | REJECTED
  Note over WK: FLAGGED/REJECTED → hide media + raise moderation
```

## 9. Fraud detection flow
```mermaid
flowchart TD
  E[Event: login / publish / order / payment] --> ENG[Risk engine rules]
  ENG --> S1[Impossible travel]
  ENG --> S2[Device reuse / multi-account]
  ENG --> S3[Duplicate / spam / keyword]
  ENG --> S4[Image flagged]
  ENG --> S5[Payment anomaly / velocity]
  S1 & S2 & S3 & S4 & S5 --> SC{Aggregate risk score}
  SC -->|low| OK[Allow]
  SC -->|medium| LIMIT[Shadow-limit / require verification]
  SC -->|high| HOLD[Auto-hold + FraudEvent + alert]
  HOLD --> QUEUE[Admin fraud queue]
  QUEUE --> ACT[Ban / purge / dismiss → AuditLog]
```

## 10. Moderation workflow
```mermaid
sequenceDiagram
  participant Rep as Reporter
  participant API
  participant Q as Moderation queue
  participant Mod as Moderator (Sana)
  participant DB
  Rep->>API: report listing/user/message (+reason)
  API->>DB: Report(status=OPEN)
  API->>Q: enqueue with priority (risk + reporter history)
  Mod->>Q: pull highest priority
  Q-->>Mod: subject + risk explanation + history
  Mod->>API: decision (approve/reject/suspend/ban/restrict)
  API->>DB: ModerationAction + update subject + AuditLog(hash-chain)
  API->>Rep: notify outcome
```
