# Build: MV Dugar AI Portal

You are building an internal web app for **MV Dugar Group** (Nepal). It gives staff who don't have a Claude seat access to Claude through the company's Anthropic API key. Each person has their own login, private chats and a monthly spending cap. Admins see spending by person and by business, but never the content of messages.

Read this whole file before writing any code. Then follow **How to work** at the bottom.

---

## 1. Context

- MV Dugar Group is a diversified business group with several businesses: automotive brands, finance, hydropower, cold chain and FMCG.
- Today some businesses share a single Claude login. That breaks Anthropic's terms and mixes everyone's chat history together. This portal replaces those shared logins.
- The owner and super-admin is **Shubham Dugar, Executive Director** (shubham@mvdugar.com).
- The company email domain is **@mvdugar.com**. Company mail is self-hosted (Carbonio at mail.mvdugar.com), **not** Google Workspace.
- The users are not technical: sales staff, recovery officers, accountants and admin staff. Some will use it on their phones. Keep the UI simple and fast, and make it work well on mobile.
- A clickable demo of this portal already exists. Section 4 describes its screens and behaviour. Match it.

## 2. Goals

1. Staff sign in with their own company email and chat with Claude privately.
2. Every API call is charged to the company's Anthropic account and logged against the person who made it and their business.
3. Each person has a monthly cap in USD. When they reach it, their chat is blocked with a clear message.
4. Each business has a monthly budget. When it is reached, everyone in that business is blocked.
5. Admins can raise or lower limits and pause or unpause users. Changes take effect immediately.
6. Admins **never** see message content, only metadata such as tokens, cost, model and time.
7. The app is cheap to host (around USD 5–10 a month for the server) and easy for a non-developer to run.

## 3. Tech stack (defaults: change only with a stated reason)

- **Next.js (App Router) + TypeScript**, Tailwind CSS for styling.
- **PostgreSQL** with **Prisma**.
- **Auth.js (NextAuth v5)**:
  - **Primary:** email one-time code / magic link sent over the company SMTP server (Carbonio). Only accept addresses ending in `@mvdugar.com`, plus an optional allowlist of individual addresses set in an env var.
  - **Optional:** Google sign-in behind a feature flag (`ENABLE_GOOGLE_AUTH`), restricted to the same domain on the server side. Do not rely only on the `hd` hint.
  - A person can sign in only if an admin has already added them as a user, or if `AUTO_PROVISION=true`, in which case they land in a "Pending approval" state until an admin assigns them a business.
- **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) with streaming responses.
- **Deployment:** Docker + `docker-compose.yml` (app + Postgres + Caddy for automatic HTTPS) so it runs on any small VPS. Also document a Vercel + managed Postgres option in the README.
- Timezone for display is **Asia/Kathmandu**. Store all times in UTC.

## 4. Screens (match the existing demo)

### 4.1 Sign-in
- MV Dugar Group branding: logo placeholder in `/public/logo.svg`, and the slogan "Making Visions and Dreams. Since 1884."
- An email field, then a one-time code. Show a clear error if the email isn't on the company domain or the user hasn't been added.

### 4.2 Staff chat
- Left sidebar: the user's own conversations (new, rename, delete), searchable by title.
- Main area: a streaming chat with Markdown rendering, code blocks with a copy button, and a stop button.
- **Allowance meter** at the top: "USD 3.40 of USD 10.00 used this month", plus a progress bar that turns amber at 80% and red at 100%.
- **Under each assistant reply:** small grey text showing tokens in/out and cost, for example "1,240 in · 380 out · $0.006".
- **Model picker** showing only the models the user's business is allowed to use (see 5.4). Default: Sonnet.
- **Attachments:** PDFs and images, up to 20 MB and 5 files per message. Send them to Claude as document/image blocks. For `.xlsx` and `.csv`, convert to CSV text on the server before sending, and tell the user it was converted.
- **Blocked state:** if the user's cap, their business's budget, or their account is paused, disable the input and show the reason in plain words: "You've used your monthly Claude allowance (USD 10.00). It resets on 1 December. Ask your manager or the ED's office if you need more." Show a different message for each reason.
- **First-use notice** (shown once, user must accept): what the tool is for, that conversations are private but usage is tracked, and that customer personal data, loan account details and passwords must not be pasted in. Store the acceptance timestamp.

### 4.3 Admin: "Usage & limits"
Visible to `SUPER_ADMIN` (everything) and `BUSINESS_ADMIN` (their own business only).
- **Top cards:** total spend this month, projected month-end spend (linear projection from days elapsed), number of active users this month, and requests this month.
- **By business:** a bar for each business showing spend against its monthly budget, with an editable budget (super admin only).
- **By person:** a table with name, business, spend this month, cap, % used, last active and status. Add an inline edit for the cap and a Pause/Unpause toggle. Make the table sortable and filterable by business.
- **Recent requests:** time, user, business, model, input/output/cached tokens, cost, duration and status (ok / blocked / error). **No message text, no titles, no file names.**
- **Users:** add a user (name, email, business, role, cap), edit, deactivate. Bulk-add by pasting CSV (name, email, business, cap).
- **Businesses:** add or edit a business (name, monthly budget, allowed models, web search on/off, which API key env var it uses).
- **Export:** a CSV of this month's usage by person and by business.
- **Audit log:** every admin action (limit changed, user paused, budget changed), with who did it, when, and the old and new values.

## 5. Core logic (get this exactly right)

### 5.1 Data model (Prisma, at minimum)
- `Business`: id, name, monthlyBudgetUsd, allowedModels[], webSearchEnabled, apiKeyEnvVar, active.
- `User`: id, name, email (unique), businessId, role (`STAFF` | `BUSINESS_ADMIN` | `SUPER_ADMIN`), monthlyCapUsd, status (`ACTIVE` | `PAUSED` | `PENDING` | `DEACTIVATED`), noticeAcceptedAt, lastActiveAt.
- `Conversation`: id, userId, title, createdAt, updatedAt, deletedAt.
- `Message`: id, conversationId, role, content (JSON blocks), createdAt. **Only the owning user can read this. No admin API route returns it.**
- `UsageEvent`: id, userId, businessId, conversationId (nullable), model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, webSearchCount, costUsd (Decimal), status, errorCode, durationMs, createdAt. **No content fields.**
- `Reservation`: see 5.3.
- `AuditLog`: id, actorId, action, targetType, targetId, before (JSON), after (JSON), createdAt.

### 5.2 Cost calculation
- Put prices in **one config file** (`src/config/pricing.ts`), per model: input, output, cache write and cache read per million tokens, plus the web search price.
- Starting values, which you **must verify** against https://platform.claude.com/docs/en/about-claude/pricing before you finish:
  - `claude-opus-5-5`: $4 in / $20 out per MTok
  - `claude-sonnet-5-5`: $2 in / $10 out per MTok
  - `claude-haiku-5-5`: $0.10 in / $0.50 out per MTok for prompts up to 100,000 tokens, and $0.50 / $2.50 above that. Implement this tiering.
  - Web search: $10 per 1,000 searches.
  - Cache write and cache read multipliers: take them from the pricing page.
- Calculate the cost from the `usage` object the API returns (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and server tool use counts). Never estimate from text length.
- Use `Decimal` for money. No floats.
- Write unit tests for every model, the Haiku tier boundary, cache tokens and web search.

### 5.3 Enforcing limits (no overspend under concurrency)
Before each call:
1. Check that the user is `ACTIVE` and the business is active.
2. Work out the user's month-to-date spend and the business's month-to-date spend. The period is the calendar month in UTC, matching Anthropic billing. Make the reset day configurable.
3. Estimate the worst-case cost of this request: input tokens from the token counting endpoint, or a safe character-based upper bound if that fails, plus `max_tokens` output at the model's price.
4. In a single DB transaction, create a `Reservation` for that worst-case amount. Reject the request if spent + open reservations + this reservation would exceed the user cap or the business budget.
5. Make the call. On completion, error or client abort, replace the reservation with the actual `UsageEvent` cost. Reservations older than 10 minutes expire automatically.
6. Limit changes and pauses are read fresh on every request (no caching), so they apply immediately.

Also:
- A per-user rate limit (for example 20 requests a minute), and a cap on concurrent streams per user (2).
- Set `max_tokens` per model in config.
- As a backstop, give each business its own **Anthropic Console workspace and API key** with a hard monthly spend limit set in the Console. The server chooses the key using `Business.apiKeyEnvVar`. Document this in the README.

### 5.4 Calling Claude
- Use the Messages API with streaming. Stream to the browser over SSE (or the AI SDK's streaming helpers if you prefer).
- **System prompt** (in config, editable by the super admin later): the assistant works for MV Dugar Group, should answer clearly and concisely, should use NPR where currency is relevant, should say so when unsure, and should never ask for passwords or customer account numbers. Allow an optional extra system prompt for each business.
- Use **prompt caching** on the system prompt and on the earlier turns of long conversations.
- **Context management:** if a conversation gets near the model's context limit, drop or summarise the oldest turns. Don't fail.
- **Web search tool:** only when `Business.webSearchEnabled` is true. Count the searches and charge them.
- Handle API errors (rate limits, overload, invalid requests) with a friendly message and retry with backoff where appropriate. Log the error code to `UsageEvent` without the content.

## 6. Security and privacy (must-haves)

- API keys live only in server environment variables. They never reach the client and are never logged.
- **No message content in logs**, error trackers or the `UsageEvent` table. Add a test that the admin API responses contain no message content.
- Every data route checks authorisation: staff see only their own conversations, business admins only their own business, and only the super admin sees everything.
- Session cookies are httpOnly, secure and SameSite=Lax. Use CSRF protection where Auth.js requires it.
- Validate uploads by type and size. Store files only as long as they're needed to send the request, or in private storage if you keep them. Never serve them publicly.
- Data retention: a setting (default 180 days) after which conversations and messages are deleted by a daily job. UsageEvents are kept.
- Users can delete their own conversations. Deleting removes the message content, while UsageEvents stay for billing.

## 7. Seed data

Create a seed script with these businesses (budgets are placeholders the admin will change):

| Business | Monthly budget (USD) |
|---|---|
| Group / ED Office | 100 |
| Mahindra | 50 |
| Tata Hitachi | 40 |
| John Deere | 40 |
| Two-Wheeler (TVS / Revolt) | 30 |
| Kaifeng EV | 20 |
| BKT | 15 |
| Manokamana (Finance) | 50 |
| Hydropower | 30 |
| Sumo Cold Chain | 15 |
| FMCG (HoneyMan) | 15 |

- One super admin: shubham@mvdugar.com.
- Default per-user cap: **USD 10 a month** (configurable).
- Default allowed models: Sonnet and Haiku for every business. Opus only for Group / ED Office.
- In development only, add a few fake staff users with usage history so the admin dashboard has something to show. Never run this part in production.

## 8. Later phases (design for them, don't build yet)

- **Phase 2:** email alerts at 80% and 100% of a user cap or business budget (to the user and their business admin); a monthly usage summary emailed to the super admin on the 1st; shared "assistants" per business (saved system prompts such as "Sales report writer" or "JD drafter").
- **Phase 3:** reconcile the portal's own cost totals against Anthropic's Usage and Cost API (Admin API key) every night and flag differences of more than 5%.

## 9. Deliverables

1. A working app in this repo, with a clean commit history (one commit per phase/milestone).
2. `README.md` written for a non-developer:
   - What you need: a domain or subdomain (e.g. `ai.mvdugar.com`), a VPS, an Anthropic Console account with workspaces and keys, and SMTP credentials.
   - Step-by-step setup, `.env` explained line by line, how to deploy with Docker, how to add a business, how to back up the database, and how to update.
   - How to set the hard spend limit for each workspace in the Anthropic Console.
3. `.env.example` with every variable and a comment explaining it.
4. Tests: unit tests (pricing, limits, reservations, authorisation) and a Playwright end-to-end test covering sign-in → chat → hitting the cap → admin raises the cap → chat works again. In tests, mock the Anthropic API. No real API calls in CI.
5. A short `SECURITY.md` listing what is logged, what isn't, and who can see what.

## 10. How to work

1. **First, don't write code.** Give me:
   - your build plan in milestones,
   - the folder structure,
   - the Prisma schema,
   - every assumption you're making and every question you have.
   Then wait for my OK.
2. Build milestone by milestone. After each one, run the tests and the linter, commit, and tell me in plain English what now works and how to try it.
3. If you find something in this spec that's wrong, risky or more expensive than it needs to be, say so before building it.
4. Before finishing, verify the model IDs and prices against the Anthropic docs, and update `pricing.ts` if anything differs.
5. Keep dependencies few and well known. Don't add paid third-party services without asking me.
