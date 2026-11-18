// Starts a throwaway Postgres for the database tests and applies the migrations.
// Set TEST_DATABASE_URL to use an existing server instead (e.g. the docker-compose one).
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let pg: EmbeddedPostgres | undefined;
  let dir: string | undefined;

  if (!url) {
    dir = await mkdtemp(path.join(tmpdir(), "portal-test-pg-"));
    const port = await freePort();
    pg = new EmbeddedPostgres({
      databaseDir: dir,
      port,
      user: "postgres",
      password: "postgres",
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("portal_test");
    url = `postgresql://postgres:postgres@127.0.0.1:${port}/portal_test`;
  }

  // The tests empty every table, so never let them near a database that isn't clearly a test one.
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes("test")) {
    throw new Error(
      `Refusing to run database tests against "${dbName}": its name must contain "test".`,
    );
  }

  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  project.provide("databaseUrl", url);

  return async () => {
    await pg?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  };
}
