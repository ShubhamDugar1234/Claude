# MV Dugar AI Portal

Internal web app that gives MV Dugar Group staff private access to Claude through the company's Anthropic API key, with per-person monthly caps and per-business budgets.

> **Status: under construction (milestone M4, attachments).** The full setup guide for non-developers arrives in milestone M7. See `SPEC.md` for the requirements and `PLAN.md` for the build plan.

## Developer quick start

Requires Node.js 24 and Docker.

```bash
cp .env.example .env   # then set AUTH_SECRET (openssl rand -base64 32)
docker compose -f docker-compose.dev.yml up -d   # local Postgres
npm install
npm run db:deploy                                # create the tables
npm run db:seed                                  # businesses + super admin
npm run db:seed:dev                              # optional: fake staff with usage (dev only)
npm run dev                                      # http://localhost:3000
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.

In development, sign-in codes are printed in the terminal running `npm run dev`.
Set `MOCK_ANTHROPIC="true"` in `.env` to chat with a free fake Claude while developing.
