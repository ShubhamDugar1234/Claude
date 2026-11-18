# MV Dugar AI Portal: build plan (draft for approval)

Status: **proposal only, no code written.** Answers to the questions at the end may change parts of this.

---

## 1. Milestones

Each milestone ends with: tests + lint pass, one git commit, and a plain-English note on what works and how to try it.

| #   | Milestone                                                                                                                                                                                                                                                                                                                                                                                                                          | What you can try at the end                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0  | **Scaffold.** `git init`, Next.js (App Router) + TS + Tailwind, ESLint/Prettier, Vitest, Playwright, Prisma schema + first migration, `docker-compose.dev.yml` with Postgres, `.env.example` skeleton.                                                                                                                                                                                                                             | `npm run dev` shows a blank branded page; `npm test` runs.                                                                                       |
| M1  | **Money core (no UI).** `pricing.ts`, cost calculator from the API `usage` object (Decimal only, Haiku tier, cache, web search), billing-period helper (UTC month, configurable reset day), reservation service (single transaction, row lock, expiry), rate limit + concurrent-stream limit. Full unit tests.                                                                                                                     | `npm test` shows every pricing/limit case passing. Built first because it's the part that must be exactly right.                                 |
| M2  | **Sign-in.** Auth.js v5 with a 6-digit email code over Carbonio SMTP, domain + allowlist check, "must already be a user" / `AUTO_PROVISION` → Pending, optional Google behind `ENABLE_GOOGLE_AUTH` (domain checked server-side), database sessions, first-use notice. Seed script (businesses, super admin, dev-only fake users + usage).                                                                                          | Sign in with a seeded email; the code prints to the console in dev. Wrong domain / unknown user shows a clear error.                             |
| M3  | **Chat.** Conversation list (new/rename/delete/search), streaming over SSE with stop, Markdown + code copy, model picker (business-allowed only, default Sonnet), allowance meter, per-reply "in · out · $" line, all three blocked states with their own wording, reservation → UsageEvent settlement on finish/error/abort, prompt caching, compaction for long chats, web search when enabled, friendly errors + retry/backoff. | Chat end to end against the real API (or the mock with `MOCK_ANTHROPIC=true`). Lower your cap in the DB → you're blocked with the right message. |
| M4  | **Attachments.** PDF/image upload (≤20 MB, ≤5 files, type-sniffed, not just extension), xlsx/csv → CSV text on the server with a "converted" notice.                                                                                                                                                                                                                                                                               | Attach a PDF and an Excel file and ask about them.                                                                                               |
| M5  | **Admin.** Usage & limits page (cards, by-business bars, by-person table with inline cap edit + pause, recent requests), Users (add/edit/deactivate, bulk CSV paste), Businesses, CSV export, Audit log. Business-admin scoping. Authorisation tests + "no message content in admin responses" test.                                                                                                                               | Sign in as super admin and as a business admin; see the different scopes.                                                                        |
| M6  | **Hardening + jobs.** Daily retention job (default 180 days), security headers, upload checks, log redaction, key-never-leaves-server checks.                                                                                                                                                                                                                                                                                      | Retention job deletes old test conversations; UsageEvents stay.                                                                                  |
| M7  | **Ship.** Production Dockerfile, `docker-compose.yml` (app + Postgres + Caddy + small cron sidecar), backup script, Playwright E2E (sign-in → chat → hit cap → admin raises cap → chat works), `README.md` for a non-developer, `SECURITY.md`, final pricing check against the live pricing page.                                                                                                                                  | Follow the README on a fresh VPS.                                                                                                                |

---

## 2. Folder structure

```
mv-dugar-ai-portal/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  ├─ seed.ts                 # businesses + super admin (safe in prod)
│  └─ seed-dev.ts             # fake staff + usage history (refuses to run if NODE_ENV=production)
├─ public/logo.svg            # placeholder logo
├─ src/
│  ├─ app/
│  │  ├─ (auth)/signin/page.tsx          # email → code
│  │  ├─ (auth)/pending/page.tsx         # "waiting for approval"
│  │  ├─ (chat)/chat/[[...id]]/page.tsx  # sidebar + chat
│  │  ├─ admin/
│  │  │  ├─ page.tsx                     # Usage & limits
│  │  │  ├─ users/page.tsx
│  │  │  ├─ businesses/page.tsx
│  │  │  └─ audit/page.tsx
│  │  └─ api/
│  │     ├─ auth/[...nextauth]/route.ts
│  │     ├─ chat/route.ts                # POST → SSE stream
│  │     ├─ conversations/route.ts       # list/create (own only)
│  │     ├─ conversations/[id]/route.ts  # get/rename/delete (own only)
│  │     ├─ me/route.ts                  # allowance meter, notice acceptance
│  │     ├─ admin/{usage,users,businesses,audit,export}/route.ts
│  │     └─ cron/retention/route.ts      # protected by CRON_SECRET
│  ├─ config/
│  │  ├─ pricing.ts           # the one place for prices
│  │  ├─ models.ts            # ids, labels, max_tokens, effort, context budget
│  │  ├─ prompts.ts           # default system prompt
│  │  └─ limits.ts            # default cap, rate limits, retention, reset day
│  ├─ lib/
│  │  ├─ db.ts  auth.ts  authz.ts  mail.ts  logger.ts (redacting)
│  │  ├─ money.ts             # Decimal helpers
│  │  ├─ period.ts            # billing period + "resets on 1 December" text
│  │  ├─ cost.ts              # usage → USD
│  │  ├─ limits/              # spend queries, reservation, rate limit, block reasons
│  │  ├─ anthropic/           # client per business key, stream → SSE, errors, mock
│  │  ├─ attachments.ts       # validation, xlsx/csv → CSV
│  │  └─ audit.ts
│  └─ components/             # chat, meter, sidebar, admin tables, etc.
├─ tests/
│  ├─ unit/                   # pricing, period, reservations, authz, no-content
│  └─ e2e/                    # Playwright, mock Anthropic + captured email codes
├─ docker/Caddyfile
├─ scripts/backup.sh  scripts/restore.sh
├─ Dockerfile  docker-compose.yml  docker-compose.dev.yml
├─ .env.example  README.md  SECURITY.md
```

---

## 3. Prisma schema (draft)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role              { STAFF BUSINESS_ADMIN SUPER_ADMIN }
enum UserStatus        { ACTIVE PAUSED PENDING DEACTIVATED }
enum MessageRole       { USER ASSISTANT }
enum UsageStatus       { OK BLOCKED ERROR ABORTED }
enum ReservationStatus { OPEN SETTLED EXPIRED }

model Business {
  id                String   @id @default(cuid())
  name              String   @unique
  monthlyBudgetUsd  Decimal  @db.Decimal(12, 4)
  allowedModels     String[]                       // e.g. ["claude-sonnet-5-5","claude-haiku-5-5"]
  webSearchEnabled  Boolean  @default(false)
  apiKeyEnvVar      String   @default("ANTHROPIC_API_KEY")  // must match ^ANTHROPIC_API_KEY(_[A-Z0-9_]+)?$
  extraSystemPrompt String?
  active            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  users        User[]
  usageEvents  UsageEvent[]
  reservations Reservation[]
}

model User {
  id               String     @id @default(cuid())
  name             String
  email            String     @unique             // stored lower-case
  emailVerified    DateTime?                      // Auth.js
  businessId       String?                        // null only while PENDING
  business         Business?  @relation(fields: [businessId], references: [id])
  role             Role       @default(STAFF)
  monthlyCapUsd    Decimal    @db.Decimal(12, 4)
  status           UserStatus @default(ACTIVE)
  noticeAcceptedAt DateTime?
  lastActiveAt     DateTime?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  accounts      Account[]
  sessions      Session[]
  conversations Conversation[]
  usageEvents   UsageEvent[]
  reservations  Reservation[]
  auditActions  AuditLog[]    @relation("AuditActor")

  @@index([businessId])
}

model Conversation {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String
  model     String?                                // last model used
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?                              // soft-delete for UI; content purged (see below)

  messages    Message[]
  usageEvents UsageEvent[]

  @@index([userId, updatedAt])
}

// Only ever read through owner-scoped queries. No admin route selects this model.
model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           MessageRole
  content        Json                              // Anthropic content blocks, incl. thinking/compaction blocks
  usageEventId   String?      @unique              // for the "1,240 in · 380 out · $0.006" line
  createdAt      DateTime     @default(now())

  @@index([conversationId, createdAt])
}

// Metadata only. No content fields, ever.
model UsageEvent {
  id                  String        @id @default(cuid())
  userId              String
  user                User          @relation(fields: [userId], references: [id])
  businessId          String
  business            Business      @relation(fields: [businessId], references: [id])
  conversationId      String?
  conversation        Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  requestedModel      String                       // what the user picked
  model               String                       // what Anthropic actually billed (may differ on fallback)
  inputTokens         Int           @default(0)
  outputTokens        Int           @default(0)
  cacheCreationTokens Int           @default(0)
  cacheReadTokens     Int           @default(0)
  webSearchCount      Int           @default(0)
  costUsd             Decimal       @db.Decimal(14, 8)
  status              UsageStatus
  errorCode           String?                      // e.g. "rate_limit_error", "cap_reached"
  durationMs          Int           @default(0)
  createdAt           DateTime      @default(now())

  @@index([businessId, createdAt])
  @@index([userId, createdAt])
}

model Reservation {
  id           String            @id @default(cuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id])
  businessId   String
  business     Business          @relation(fields: [businessId], references: [id])
  amountUsd    Decimal           @db.Decimal(14, 8)  // worst-case cost
  status       ReservationStatus @default(OPEN)
  createdAt    DateTime          @default(now())
  expiresAt    DateTime                              // createdAt + 10 min; past this it's ignored
  settledAt    DateTime?
  usageEventId String?           @unique

  @@index([userId, status, expiresAt])
  @@index([businessId, status, expiresAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String
  actor      User     @relation("AuditActor", fields: [actorId], references: [id])
  action     String                                // "user.cap_changed", "user.paused", "business.budget_changed", ...
  targetType String                                // "User" | "Business" | "Setting"
  targetId   String
  before     Json?
  after      Json?
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([targetType, targetId])
}

// Super-admin-editable settings: system prompt, retention days, default cap.
model Setting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}

// ---- Auth.js tables ----
model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model VerificationToken {
  identifier String
  token      String   @unique                      // hashed 6-digit code
  expires    DateTime

  @@unique([identifier, token])
}
```

Phase 2/3 fit without reshaping: alerts add an `AlertSent(scope, scopeId, period, threshold)` table; assistants add `Assistant(businessId, name, systemPrompt)` + `Conversation.assistantId`; reconciliation adds `ReconciliationRun`. Not built now.

---

## 4. How the key pieces will work

- **Reservation transaction:** `SELECT … FOR UPDATE` on the Business row (serialises all reservations within one business, which covers the user too), then sum month-to-date `UsageEvent.costUsd` + open, unexpired reservations for both user and business, compare, insert. Expired reservations are simply ignored by queries, so no cleanup job is needed for correctness.
- **Rate limit (20/min) and concurrency (2 streams):** counted in Postgres (reservations in the last minute / open reservations), not in memory, so it also works on Vercel or with more than one app instance.
- **Fresh reads:** user status, cap, business budget/active are read inside the same transaction on every request. Sessions are stored in the DB, so pausing or deactivating someone also ends their session immediately.
- **Worst-case estimate:** `count_tokens` for input (fallback: characters ÷ 2 as a safe upper bound), plus `max_tokens` at the output price, at the highest price tier that could apply.
- **Settlement:** in a `finally` that runs on success, error and client abort, the stream's final `usage` becomes a UsageEvent and the reservation is marked SETTLED. On abort we still get the tokens used so far.
- **Delete conversation:** the conversation row is soft-deleted (`deletedAt`) and its Message rows are hard-deleted immediately. UsageEvents remain.
- **Email codes in tests/dev:** a mail transport that logs the code (dev) or writes it where Playwright can read it (test). Never in production.

---

## 5. Assumptions

1. One business per user. Super admin belongs to Group / ED Office and has a cap like everyone else (proposed USD 100).
2. Business admins can change caps and pause/unpause users in their own business, and add users to their own business. They can't change budgets, models or roles.
3. Conversation titles come from the first ~60 characters of the first message (no extra API call). Users can rename.
4. UI is English only.
5. Model defaults (in `models.ts`, admin-tunable later): Sonnet effort `low`, Haiku `low`, Opus `medium`; `max_tokens` 16,000 for all three; compaction when a conversation passes ~150K input tokens.
6. Billing period = calendar month UTC, reset day configurable (default 1). The "resets on…" text is shown in Asia/Kathmandu time.
7. Allowance meter shows the personal cap; if the business budget is the tighter limit, a small note says so.
8. Retention and reservation expiry run from a tiny cron sidecar in docker-compose calling a secret-protected route (Vercel Cron on Vercel).
9. I'll `git init` this folder (it isn't a repo yet) and commit per milestone. No remote unless you give me one.
10. `apiKeyEnvVar` is restricted to names matching `ANTHROPIC_API_KEY…` so an admin can't point it at `DATABASE_URL` or `AUTH_SECRET`.
