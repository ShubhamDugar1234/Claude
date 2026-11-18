// Starts everything the end-to-end tests need: a throwaway Postgres with migrations, seed data
// and test users, then the built app with emails written to files instead of being sent.
// Used by playwright.config.ts. Never point this at a real database.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seed } from "../prisma/seed";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB_PORT = PORT + 1000;
const OUTBOX = path.resolve(".e2e/outbox");

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "portal-e2e-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: DB_PORT,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("portal_e2e_test");
  const url = `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/portal_e2e_test`;

  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  await seed(db);
  const mahindra = await db.business.findUniqueOrThrow({ where: { name: "Mahindra" } });
  // One set of users per Playwright project, so desktop and mobile runs don't share codes.
  for (const p of ["desktop", "mobile"]) {
    await db.user.createMany({
      data: [
        {
          email: `e2e.${p}.staff@mvdugar.com`,
          name: "Asha Staff",
          businessId: mahindra.id,
          monthlyCapUsd: "10",
        },
        {
          email: `e2e.${p}.pending@mvdugar.com`,
          name: "Pending Person",
          status: "PENDING",
          monthlyCapUsd: "10",
        },
        {
          email: `e2e.${p}.chat@mvdugar.com`,
          name: "Chandra Chat",
          businessId: mahindra.id,
          monthlyCapUsd: "10",
          noticeAcceptedAt: new Date(),
        },
        {
          email: `e2e.${p}.capped@mvdugar.com`,
          name: "Kamal Capped",
          businessId: mahindra.id,
          monthlyCapUsd: "0.01",
          noticeAcceptedAt: new Date(),
        },
        {
          email: `e2e.${p}.gone@mvdugar.com`,
          name: "Gone Person",
          businessId: mahindra.id,
          status: "DEACTIVATED",
          monthlyCapUsd: "10",
        },
      ],
    });
  }
  // The capped users have already used their whole allowance this month.
  for (const capped of await db.user.findMany({ where: { email: { contains: ".capped@" } } })) {
    await db.usageEvent.create({
      data: {
        userId: capped.id,
        businessId: mahindra.id,
        requestedModel: "claude-sonnet-5-5",
        model: "claude-sonnet-5-5",
        costUsd: "0.01",
        status: "OK",
      },
    });
  }
  await db.$disconnect();

  await rm(OUTBOX, { recursive: true, force: true });
  await mkdir(OUTBOX, { recursive: true });
  await writeFile(path.resolve(".e2e/database-url"), url);

  const app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: url,
        AUTH_SECRET: "e2e-secret-not-for-production-use-0123456789",
        AUTH_URL: `http://localhost:${PORT}`,
        MAIL_TRANSPORT: "file",
        MAIL_OUTBOX_DIR: OUTBOX,
        ALLOW_TEST_MAIL_TRANSPORT: "true",
        // Fake Claude: no network calls or cost in tests.
        MOCK_ANTHROPIC: "true",
        ALLOW_MOCK_ANTHROPIC: "true",
      },
    },
  );

  const shutdown = async () => {
    app.kill("SIGTERM");
    await pg.stop().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  app.on("exit", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
