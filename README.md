# MV Dugar AI Portal

Internal web app that gives MV Dugar Group staff private access to Claude through the company's Anthropic API key, with per-person monthly caps and per-business budgets.

> **Status: under construction (milestone M0, project skeleton).** The full setup guide for non-developers arrives in milestone M7. See `SPEC.md` for the requirements and `PLAN.md` for the build plan.

## Developer quick start

Requires Node.js 24 and Docker.

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # local Postgres
npm install
npm run db:deploy                                # create the tables
npm run dev                                      # http://localhost:3000
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.
