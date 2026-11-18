import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDailyJobs } from "@/lib/jobs/daily";
import { canSendCode, issueLoginCode, MAX_CODES_PER_IP_PER_HOUR } from "@/lib/auth/login-codes";
import type { ClaudeClient } from "@/lib/claude/types";
import { createBusiness, createUser, makeDb, resetDb, TEST_LIMITS, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(() => {
  db = makeDb();
  process.env.AUTH_SECRET = "test-secret";
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
});

const NOW = new Date("2026-11-18T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

function fileClient() {
  const deleted: string[] = [];
  const client = {
    deleteFile: async (id: string) => void deleted.push(id),
  } as unknown as ClaudeClient;
  return { client, deleted };
}

describe("daily job", () => {
  it("deletes conversations untouched for 180 days, with their files, and keeps usage records", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const make = async (title: string, updatedAt: Date, fileId?: string) => {
      const c = await db.conversation.create({ data: { userId: u.id, title } });
      await db.message.create({
        data: {
          conversationId: c.id,
          role: "USER",
          content: fileId
            ? [
                { type: "document", source: { type: "file", file_id: fileId } },
                { type: "text", text: "hi" },
              ]
            : [{ type: "text", text: "hi" }],
        },
      });
      await db.usageEvent.create({
        data: {
          userId: u.id,
          businessId: b.id,
          conversationId: c.id,
          requestedModel: "m",
          model: "m",
          costUsd: "0.01",
          status: "OK",
        },
      });
      await db.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${updatedAt} WHERE id = ${c.id}`;
      return c.id;
    };
    const old = await make("Old chat", daysAgo(181), "file_old");
    const recent = await make("Recent chat", daysAgo(179));

    const files = fileClient();
    const result = await runDailyJobs(db, () => files.client, NOW, TEST_LIMITS);

    expect(result.conversationsDeleted).toBe(1);
    expect(files.deleted).toEqual(["file_old"]);
    expect(await db.message.count({ where: { conversationId: old } })).toBe(0);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: old } })).title).toBe("");
    expect(await db.message.count({ where: { conversationId: recent } })).toBe(1);
    expect(await db.usageEvent.count()).toBe(2);

    // Running again changes nothing.
    expect(
      (await runDailyJobs(db, () => files.client, NOW, TEST_LIMITS)).conversationsDeleted,
    ).toBe(0);
  });

  it("honours a different retention period", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const c = await db.conversation.create({ data: { userId: u.id, title: "x" } });
    await db.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${daysAgo(31)} WHERE id = ${c.id}`;
    const r = await runDailyJobs(db, () => fileClient().client, NOW, {
      ...TEST_LIMITS,
      retentionDays: 30,
    });
    expect(r.conversationsDeleted).toBe(1);
  });

  it("cleans up expired reservations, old sign-in codes and expired sessions", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    await db.reservation.create({
      data: { userId: u.id, businessId: b.id, amountUsd: "1", expiresAt: daysAgo(1) },
    });
    await db.reservation.create({
      data: {
        userId: u.id,
        businessId: b.id,
        amountUsd: "1",
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });
    await issueLoginCode(db, { email: "a@mvdugar.com", authToken: "t", now: daysAgo(2) });
    await issueLoginCode(db, { email: "a@mvdugar.com", authToken: "t2", now: NOW });
    await db.session.create({ data: { sessionToken: "old", userId: u.id, expires: daysAgo(1) } });
    await db.session.create({
      data: { sessionToken: "live", userId: u.id, expires: daysAgo(-10) },
    });

    const r = await runDailyJobs(db, () => fileClient().client, NOW, TEST_LIMITS);
    expect(r).toMatchObject({ reservationsExpired: 1, loginCodesDeleted: 1, sessionsDeleted: 1 });
    expect(await db.session.findMany({ select: { sessionToken: true } })).toEqual([
      { sessionToken: "live" },
    ]);
  });
});

describe("sign-in code limits per network", () => {
  it(`allows ${MAX_CODES_PER_IP_PER_HOUR} codes an hour from one IP, across addresses`, async () => {
    for (let i = 0; i < MAX_CODES_PER_IP_PER_HOUR; i++) {
      await issueLoginCode(db, {
        email: `p${i}@mvdugar.com`,
        authToken: `t${i}`,
        ipHash: "ip-a",
        now: NOW,
      });
    }
    expect(await canSendCode(db, "new@mvdugar.com", NOW, "ip-a")).toBe(false);
    expect(await canSendCode(db, "new@mvdugar.com", NOW, "ip-b")).toBe(true);
    expect(
      await canSendCode(db, "new@mvdugar.com", new Date(NOW.getTime() + 61 * 60_000), "ip-a"),
    ).toBe(true);
  });
});
