# MV Dugar AI Portal

An internal website that gives MV Dugar Group staff their own private access to Claude, paid for by the company's Anthropic account.

- Everyone signs in with their own company email and gets a 6-digit code by email. No passwords.
- Each person's chats are private. Admins see **how much** people use, never **what** they wrote.
- Each person has a monthly allowance (for example USD 10). Each business has a monthly budget. When either is used up, chat stops with a clear message until the 1st of next month or until an admin raises the limit.
- Admins can raise or lower limits, pause people and add users. Changes apply to the very next message.

This guide is written for someone who is comfortable following instructions but is not a programmer. Technical details for developers are at the end.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Set up Anthropic (the Claude account)](#2-set-up-anthropic-the-claude-account)
3. [Point your domain at the server](#3-point-your-domain-at-the-server)
4. [Prepare the server](#4-prepare-the-server)
5. [Fill in the settings file (.env)](#5-fill-in-the-settings-file-env)
6. [Start the portal](#6-start-the-portal)
7. [Everyday admin tasks](#7-everyday-admin-tasks)
8. [Backups](#8-backups)
9. [Updating to a new version](#9-updating-to-a-new-version)
10. [Troubleshooting](#10-troubleshooting)
11. [Alternative: Vercel and a managed database](#11-alternative-vercel-and-a-managed-database)
12. [Prices and how costs are worked out](#12-prices-and-how-costs-are-worked-out)
13. [For developers](#13-for-developers)

---

## 1. What you need

| What                                                                                                           | Why                                                                                                                    | Typical cost                          |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **A web address** such as `ai.mvdugar.com`                                                                     | Where staff open the portal. A sub-address of the company domain is easiest.                                           | Free if you already own `mvdugar.com` |
| **A small Linux server (VPS)** with 2 GB memory, 1–2 CPUs, 25 GB disk, Ubuntu 24.04                            | Runs the portal and its database. Any provider works (e.g. Hetzner, DigitalOcean, Vultr, Linode, or a local provider). | About USD 6–12 a month                |
| **An Anthropic Console account** at [console.anthropic.com](https://console.anthropic.com) with billing set up | This is where Claude usage is billed.                                                                                  | Pay for what staff use                |
| **An email account for sending codes**, e.g. `noreply@mvdugar.com` on Carbonio, and its SMTP password          | Sign-in codes are emailed from the company mail server.                                                                | Free (existing mail server)           |

> Why 2 GB? Building the portal needs about 1.5 GB of memory for a minute or two. Once running it uses much less.

---

## 2. Set up Anthropic (the Claude account)

All API usage is billed to the company's Anthropic account. The portal enforces each person's and each business's limits, but as a **safety net** you should also set a hard monthly spending limit in Anthropic itself, so nothing can ever run up a surprise bill.

The menu names below are how the Console looked when this guide was written. They may move slightly.

### Option A: one key for the whole group (simplest)

1. Sign in at [console.anthropic.com](https://console.anthropic.com).
2. Open **Settings → Workspaces** and create a workspace called `AI Portal`.
3. In that workspace, open its **Limits** and set a **monthly spend limit** a little above the total of all business budgets (for example USD 450).
4. Open **Settings → API keys**, choose **Create key**, pick the `AI Portal` workspace, and name it `ai-portal`. Copy the key (it starts with `sk-ant-`). You will only see it once.
5. Put the key in `ANTHROPIC_API_KEY` in your `.env` file (step 5).

### Option B: one key per business (a hard limit per business)

This means even a mistake in the portal can never let one business spend more than its own Console limit.

1. Create one workspace per business, e.g. `Portal - Mahindra`, `Portal - Manokamana`.
2. In each workspace's **Limits**, set the monthly spend limit to that business's budget (or slightly above it).
3. Create one API key in each workspace.
4. Add each key to `.env` under its own name, using **only capital letters, numbers and underscores after `ANTHROPIC_API_KEY_`**:
   ```
   ANTHROPIC_API_KEY_MAHINDRA="sk-ant-..."
   ANTHROPIC_API_KEY_MANOKAMANA="sk-ant-..."
   ```
5. In the portal, go to **Admin → Businesses → Edit** for each business and set **API key setting** to that name (e.g. `ANTHROPIC_API_KEY_MAHINDRA`). The Businesses page shows "set on the server" when the key is found, so you can check it worked.

Businesses you haven't changed keep using `ANTHROPIC_API_KEY`.

---

## 3. Point your domain at the server

In the DNS settings for `mvdugar.com` (wherever the domain is managed), add an **A record**:

| Type | Name | Value                    |
| ---- | ---- | ------------------------ |
| A    | `ai` | your server's IP address |

It can take a few minutes to an hour to work. The portal gets its HTTPS certificate automatically once it does.

---

## 4. Prepare the server

Connect to your server (your VPS provider shows how, usually `ssh root@<ip-address>`), then run these commands one at a time.

Install Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Open the web ports (if the server uses the `ufw` firewall):

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Copy the portal onto the server. If it's in a Git repository:

```bash
git clone <your-repository-address> /opt/ai-portal && cd /opt/ai-portal
```

(Without Git, copy the project folder to `/opt/ai-portal` with an SFTP app such as FileZilla, then `cd /opt/ai-portal`.)

---

## 5. Fill in the settings file (.env)

Create your settings file from the example:

```bash
cp .env.example .env && nano .env
```

Fill in each line as described below (in `nano`, save with Ctrl+O then Enter, exit with Ctrl+X). To make the random secrets, run `openssl rand -hex 24` and copy what it prints.

| Setting                                                      | What to put                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                                     | The portal's address without `https://`, e.g. `ai.mvdugar.com`                                                                         |
| `APP_URL`, `AUTH_URL`                                        | The same address with `https://`, e.g. `https://ai.mvdugar.com`                                                                        |
| `POSTGRES_PASSWORD`                                          | A random password for the database (letters and numbers only). Use `openssl rand -hex 24`.                                             |
| `DATABASE_URL`                                               | Leave as it is. Docker sets the real one automatically.                                                                                |
| `AUTH_SECRET`                                                | A long random secret. Use `openssl rand -base64 32`. Changing it later signs everyone out.                                             |
| `COMPANY_EMAIL_DOMAIN`                                       | `mvdugar.com`                                                                                                                          |
| `ALLOWED_EMAILS`                                             | Usually empty. Add outside addresses (comma-separated) only if someone without a company mailbox needs access.                         |
| `AUTO_PROVISION`                                             | `false` means you add every user yourself (recommended). `true` lets anyone with a company address sign in and wait for your approval. |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`                      | The first admin (you). Created automatically on first start.                                                                           |
| `ENABLE_GOOGLE_AUTH`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Leave `false` and empty unless you want a Google button (see [Troubleshooting](#10-troubleshooting)).                                  |
| `SMTP_HOST`                                                  | `mail.mvdugar.com`                                                                                                                     |
| `SMTP_PORT`                                                  | `587`                                                                                                                                  |
| `SMTP_USER`, `SMTP_PASSWORD`                                 | The mailbox that sends codes, e.g. `noreply@mvdugar.com`, and its password                                                             |
| `MAIL_FROM`                                                  | How the sender appears, e.g. `MV Dugar AI Portal <noreply@mvdugar.com>`                                                                |
| `ANTHROPIC_API_KEY`                                          | The key from step 2 (`sk-ant-...`). Add `ANTHROPIC_API_KEY_<NAME>` lines for per-business keys.                                        |
| `DEFAULT_USER_CAP_USD`                                       | Monthly allowance given to new users. `10` is a good start.                                                                            |
| `BILLING_RESET_DAY`                                          | Keep `1` (matches Anthropic's monthly bill).                                                                                           |
| `RATE_LIMIT_PER_MINUTE`                                      | Keep `20`.                                                                                                                             |
| `MAX_CONCURRENT_STREAMS`                                     | Keep `2`.                                                                                                                              |
| `RETENTION_DAYS`                                             | Chats unused for this many days are deleted. `180` = about 6 months.                                                                   |
| `CRON_SECRET`                                                | A random secret for the daily clean-up job. Use `openssl rand -hex 24`.                                                                |

Lock the file so only the server's administrator can read it:

```bash
chmod 600 .env
```

---

## 6. Start the portal

```bash
docker compose up -d --build
```

The first start takes 3–5 minutes (it builds the portal). It then:

1. starts the database,
2. sets up the tables and creates the 11 businesses and your super admin account,
3. starts the portal and gets the HTTPS certificate,
4. schedules the daily clean-up at 03:00 Nepal time.

Check that everything is running:

```bash
docker compose ps
```

`app`, `db`, `caddy` and `cron` should say "running" (and `migrate` "exited (0)", which means it finished). Then open `https://ai.mvdugar.com`, enter your email, and type the code from your inbox. You'll be asked to accept the short notice once, then you're in. The **Admin** link is under your name at the bottom of the chat sidebar.

---

## 7. Everyday admin tasks

Everything is under **Admin** (bottom-left of the chat screen).

| Task                                                                     | Where                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| See spending this month, by business and by person                       | **Usage & limits**                                                                                          |
| Raise or lower someone's monthly cap                                     | **Usage & limits** → click the cap amount in their row, type the new amount, press Enter                    |
| Pause or unpause someone                                                 | **Usage & limits** → Pause / Unpause in their row                                                           |
| Change a business's monthly budget                                       | **Usage & limits** → click the budget amount (super admin only)                                             |
| Add one person                                                           | **Users** → Add a person                                                                                    |
| Add many people                                                          | **Users** → Add many people → paste lines of `name, email, business, cap` (you can copy columns from Excel) |
| Approve someone who signed in by themselves (when `AUTO_PROVISION=true`) | **Users** → Waiting for approval → Review → choose their business → Approve                                 |
| Remove someone's access                                                  | **Users** → Edit → Status: Deactivated (they're signed out immediately)                                     |
| Make someone a business admin                                            | **Users** → Edit → Role: Business admin (super admin only)                                                  |
| Add a business, choose its models, turn web search on, set its API key   | **Businesses** (super admin only)                                                                           |
| Download this month's usage                                              | **Usage & limits** → Export CSV (by business or by person)                                                  |
| See who changed what                                                     | **Audit log**                                                                                               |

**Who can do what:**

- **Super admin**: everything.
- **Business admin**: sees only their own business. Can add staff to it, change their caps, and pause them. Can't change budgets, models or roles.
- **Staff**: chat only.

**How limits work:** before each message, the portal sets aside the most that message could possibly cost. If that would go over the person's cap or their business's budget, the message is refused with a plain explanation. If a little allowance is left, the reply is shortened to fit rather than refused. Afterwards, only the real cost is charged.

---

## 8. Backups

The database holds users, limits, usage history and everyone's chats. Back it up every day.

Make a backup now:

```bash
cd /opt/ai-portal && ./scripts/backup.sh
```

Backups go in `/opt/ai-portal/backups/` and the newest 30 are kept. To run it automatically every night at 02:00 server time, open the server's scheduler with `crontab -e` and add this line:

```
0 2 * * * cd /opt/ai-portal && ./scripts/backup.sh >> backups/backup.log 2>&1
```

**Keep a copy off the server** too (for example, download the `backups` folder weekly to a company computer or private cloud storage). Backups contain everyone's private chats, so store them as carefully as the server itself.

To restore a backup (this **replaces all current data**):

```bash
./scripts/restore.sh backups/portal-20261118-020000.sql.gz
```

---

## 9. Updating to a new version

```bash
cd /opt/ai-portal && ./scripts/backup.sh && git pull && docker compose up -d --build
```

The database is updated automatically during the restart. Staff may see a few seconds of interruption.

---

## 10. Troubleshooting

**See what the portal is doing:**

```bash
docker compose logs --tail=100 app
```

The logs never contain message text.

**Sign-in codes don't arrive.**

- Check the spam folder.
- Check `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD` in `.env`, then run `docker compose up -d` to apply the change.
- The logs show `[auth] sending sign-in code failed:` with an error code. The mail server administrator can use it to check the cause (for example, the server's IP not being allowed to send).

**"The portal's connection to Claude isn't set up correctly."** The business's API key is missing or wrong. Check **Admin → Businesses**: it shows whether the key is set. Fix the key in `.env`, then run `docker compose up -d`.

**"Claude is very busy" or "too many requests".** Anthropic is temporarily overloaded, or the account has reached its rate limit. Wait a minute. If it happens often, ask Anthropic to raise the account's rate limits.

**The website doesn't load or shows a certificate error.** Check the DNS A record points to the server (step 3) and that ports 80 and 443 are open. `docker compose logs caddy` shows certificate problems.

**Someone was locked out by too many sign-in attempts.** They can request a new code after an hour (at most 5 codes per address per hour).

**Optional Google sign-in.** In [Google Cloud Console](https://console.cloud.google.com), create an OAuth client of type "Web application". Add `https://ai.mvdugar.com/api/auth/callback/google` as an authorised redirect address. Then put the client ID and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, and set `ENABLE_GOOGLE_AUTH="true"`. Only Google accounts on `mvdugar.com` are accepted, and the person must already be a user.

---

## 11. Alternative: Vercel and a managed database

Instead of your own server, you can run the portal on [Vercel](https://vercel.com) with a managed PostgreSQL database such as Neon, Supabase or Vercel Postgres. There is no server to maintain, but it may cost more.

1. Create a PostgreSQL database with your provider and copy its connection address.
2. Import the repository into Vercel.
3. Add every setting from `.env.example` in **Project → Settings → Environment Variables**. Set `DATABASE_URL` to the provider's address, and `APP_URL`/`AUTH_URL` to the Vercel address or your own domain. `DOMAIN` and `POSTGRES_PASSWORD` aren't needed.
4. Change the **Build Command** to `npx prisma migrate deploy && npm run build`, so the database is updated on every deploy. After the first deploy, run `npm run db:seed` once from your computer with `DATABASE_URL` set to the managed database.
5. `vercel.json` already schedules the daily clean-up. Vercel sends `CRON_SECRET` automatically.
6. Long replies can take a few minutes. The chat route allows up to 300 seconds, which needs a Vercel plan that allows it. On plans with a shorter limit, very long replies may be cut off.

Rate limits and spending checks are stored in the database, so they work on Vercel too.

---

## 12. Prices and how costs are worked out

- Prices are in one file: `src/config/pricing.ts`. They were last checked against [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) on **18 November 2026**:

  | Model                                                               | Input (per million tokens) | Output (per million tokens) | Cache read |
  | ------------------------------------------------------------------- | -------------------------- | --------------------------- | ---------- |
  | Claude Opus 5.5 (`claude-opus-5-5`)                                 | USD 4                      | USD 20                      | USD 0.20   |
  | Claude Sonnet 5.5 (`claude-sonnet-5-5`)                             | USD 2                      | USD 10                      | USD 0.10   |
  | Claude Haiku 5.5 (`claude-haiku-5-5`), prompts up to 100,000 tokens | USD 0.10                   | USD 0.50                    | USD 0.01   |
  | Claude Haiku 5.5, prompts over 100,000 tokens                       | USD 0.50                   | USD 2.50                    | USD 0.05   |
  | Web search                                                          | USD 10 per 1,000 searches  |                             |            |

- The cost of every message is calculated from the exact token counts Anthropic reports, never estimated from text length.
- When Anthropic changes prices, a developer updates `src/config/pricing.ts` and runs the tests.
- Default models: every business gets Sonnet and Haiku. Group / ED Office also gets Opus.

---

## 13. For developers

**Stack:** Next.js 16 (App Router) and TypeScript, Tailwind CSS 4, PostgreSQL with Prisma 7, Auth.js v5 (database sessions, emailed 6-digit codes), and the Anthropic TypeScript SDK (streaming, prompt caching, server-side compaction, Files API).

**Local development** (Node.js 24 and Docker):

```bash
cp .env.example .env
```

In `.env`, set `APP_URL` and `AUTH_URL` to `http://localhost:3000`, set `AUTH_SECRET`, and uncomment `MAIL_TRANSPORT="console"` and (optionally) `MOCK_ANTHROPIC="true"`.

```bash
docker compose -f docker-compose.dev.yml up -d
npm install && npm run db:deploy && npm run db:seed && npm run db:seed:dev
npm run dev
```

Sign-in codes print in the terminal. `db:seed:dev` adds fake staff with a month of usage, so the admin pages have data. It refuses to run in production.

**Checks:**

| Command             | What it runs                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run lint`      | ESLint and Prettier                                                                                         |
| `npm run typecheck` | TypeScript                                                                                                  |
| `npm test`          | Unit tests, plus database tests against a throwaway PostgreSQL that starts automatically (no Docker needed) |
| `npm run test:e2e`  | Playwright on desktop and mobile, with the full stack, a mocked Claude and emails written to files          |

CI (`.github/workflows/ci.yml`) runs all of these and builds both Docker images. No real Anthropic calls are ever made in tests.

**Where things are:**

| Path                        | Contents                                                                    |
| --------------------------- | --------------------------------------------------------------------------- |
| `src/config/`               | Models, prices, limits, the system prompt                                   |
| `src/lib/limits/reserve.ts` | Spending checks with row locks (no overspend under concurrency)             |
| `src/lib/cost.ts`           | Cost calculation, including `usage.iterations`                              |
| `src/lib/chat/service.ts`   | One chat turn: reserve, stream, save, settle                                |
| `src/lib/claude/`           | Anthropic SDK wrapper and the mock                                          |
| `src/lib/admin/`            | Scoped admin queries and changes, plus the audit log (never reads messages) |
| `src/lib/auth/`             | Sign-in rules, codes, our Prisma 7 Auth.js adapter                          |
| `src/proxy.ts`              | Nonce-based Content Security Policy                                         |
| `SECURITY.md`               | What is logged and who can see what                                         |
| `SPEC.md`, `PLAN.md`        | The original requirements and build plan                                    |

**Designed for later phases** (not built yet): alerts at 80% and 100% of a cap or budget, a monthly summary email, shared assistants per business, and nightly reconciliation against Anthropic's Usage and Cost API.
