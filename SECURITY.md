# Security and privacy

This page explains what the MV Dugar AI Portal stores, what it logs, and who can see what.

## Who can see what

|                                                                        | The person themselves                    | Business admin (own business only) | Super admin |
| ---------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | ----------- |
| Their own chats (messages, titles, attached file names)                | Yes                                      | **No**                             | **No**      |
| Usage: number of requests, tokens, cost, model, time, duration, status | Yes (their own total and per-reply cost) | Yes                                | Yes         |
| Monthly cap and % used, last active time, status                       | Their own allowance meter                | Yes                                | Yes         |
| Business budget and spend                                              | A note when it's nearly used             | Yes                                | Yes         |
| Audit log of admin changes                                             | No                                       | Entries for their business         | Yes         |

Admins **never** see message content. No admin page, admin API route or export reads the `Message` table or conversation titles. Automated tests put secret text and a file name into a real chat, then check that neither appears in any admin output.

## What is stored, and where

| Data                                                                                                        | Where                                                                                                                | How long                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Messages, conversation titles, converted spreadsheet text, attachment names                                 | The portal's PostgreSQL database, readable only through the owner's own session                                      | Until the user deletes the chat, or it goes unused for `RETENTION_DAYS` (default 180), after which the daily job deletes it |
| Uploaded PDFs and images                                                                                    | Anthropic's Files API, in the company's own Anthropic account (private to it). Never stored or served by the portal. | Deleted at Anthropic when the chat is deleted (by the user or the retention job), or when the request is refused            |
| Usage records (`UsageEvent`): user, business, model, token counts, cost, time, duration, status, error code | Database                                                                                                             | Kept for billing. **No content fields exist in this table.**                                                                |
| Users, roles, caps, businesses, budgets, audit log                                                          | Database                                                                                                             | Kept                                                                                                                        |
| Sign-in codes                                                                                               | Database, **hashed** (the code itself is never stored), with a hash of the requester's IP address                    | Deleted after a day                                                                                                         |
| Login sessions                                                                                              | Database (httpOnly, Secure, SameSite=Lax cookie in the browser)                                                      | 30 days, or until sign-out or deactivation                                                                                  |
| Backups (`scripts/backup.sh`)                                                                               | `backups/` on the server, plus wherever you copy them                                                                | Newest 30 kept on the server. **They contain chats: store copies privately.**                                               |

Messages are sent to Anthropic to generate replies. Anthropic's commercial terms apply to API data (API data is not used for model training by default). See Anthropic's [privacy and data usage pages](https://www.anthropic.com/legal) for their retention periods.

## What is logged

The server log (`docker compose logs app`) contains only:

- fixed messages and short codes, e.g. `[chat] Claude call failed: overloaded_error`, or `[auth] sending sign-in code failed: ECONNREFUSED`,
- counts, e.g. the daily job's summary or `could not delete 2 uploaded file(s)`.

It **never** contains message text, titles, file names, email addresses, sign-in codes or API keys. A test checks every `console` call in the code for this. Errors from Anthropic or the mail server are reduced to their error type before logging, because raw error messages can include personal data.

No request log is written by Caddy, so request addresses are not stored on disk. Prisma query logging is off.

## Keys and secrets

- Anthropic API keys exist only in server environment variables (`.env`). They are never sent to the browser, never stored in the database and never logged.
- A business's API key setting can only name variables called `ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY_<NAME>`. An admin can't point the portal at another secret, such as `DATABASE_URL`.
- Code that touches keys, the database or email is marked `server-only`, so the build fails if browser code imports it. A test checks this.
- `AUTH_SECRET` signs sessions and salts the code and IP hashes. `CRON_SECRET` protects the daily job and is compared in constant time.
- Keep `.env` readable only by the server administrator (`chmod 600 .env`).

## Sign-in protections

- Only `@mvdugar.com` addresses (plus any addresses in `ALLOWED_EMAILS`) can sign in, and only if an admin has added them. With `AUTO_PROVISION=true`, unknown company addresses wait as Pending.
- 6-digit codes expire after 10 minutes, work once, and stop working after 5 wrong tries.
- At most 5 codes per address per hour, and 20 per network (IP address) per hour.
- The code unlocks a long random token that never leaves the server, so the sign-in endpoint can't be brute-forced directly.
- Deactivating a user deletes all their sessions immediately. Paused users can sign in but can't chat.
- Google sign-in (optional) checks the company domain and Google's `email_verified` on the server, not just the `hd` hint.

## Web protections

- A strict Content Security Policy with a fresh nonce on every request: only the portal's own scripts run, and the site can't be framed.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS over HTTPS.
- Requests that change data check that they come from the portal's own pages, on top of SameSite cookies.
- Uploads are checked by their actual bytes (not just the file name): 5 files, 20 MB each. Spreadsheets are size-checked before they're unpacked.
- Every data route checks the signed-in user. Staff can only reach their own conversations, business admins only their own business, and only the super admin reaches everything.

## Spending protections

- Each request's worst-case cost is reserved in a database transaction holding row locks on the user and business, so simultaneous requests can't overspend a cap or budget.
- Limits, pauses and deactivations are read fresh on every request.
- Recommended backstop: a hard monthly spend limit on each Anthropic Console workspace (see README, step 2).

## Reporting a problem

If you think you've found a security or privacy problem, tell the ED's office (Shubham Dugar) directly rather than discussing it in a group chat.
