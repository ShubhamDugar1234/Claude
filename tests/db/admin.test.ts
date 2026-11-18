import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getOverview, exportCsv } from "@/lib/admin/overview";
import { bulkCreateUsers, createUser, listUsers, updateUser } from "@/lib/admin/users";
import { createBusiness, listBusinesses, updateBusiness } from "@/lib/admin/businesses";
import { listAudit } from "@/lib/admin/audit";
import { AdminError, scopeFor, type AdminScope } from "@/lib/admin/scope";
import { runChatTurn } from "@/lib/chat/service";
import { createMockClaude } from "@/lib/claude/mock";
import { prepareAttachments } from "@/lib/attachments";
import { reserve } from "@/lib/limits/reserve";
import { TINY_PDF } from "../fixtures/make-xlsx";
import {
  createBusiness as makeBusiness,
  createUser as makeUser,
  makeDb,
  resetDb,
  TEST_LIMITS,
  type TestDb,
} from "./helpers";

let db: TestDb;
beforeAll(() => {
  db = makeDb();
});
afterAll(async () => {
  await db.$disconnect();
});

let mahindra: { id: string; name: string };
let finance: { id: string; name: string };
let superAdmin: AdminScope;
let mahindraAdmin: AdminScope;
let ram: { id: string; email: string };
let gita: { id: string; email: string };

beforeEach(async () => {
  await resetDb(db);
  mahindra = await makeBusiness(db, { budget: "50" });
  finance = await makeBusiness(db, { budget: "50" });
  const sup = await db.user.create({
    data: {
      name: "Super",
      email: "super@mvdugar.com",
      role: "SUPER_ADMIN",
      businessId: mahindra.id,
      monthlyCapUsd: "100",
    },
  });
  const badmin = await db.user.create({
    data: {
      name: "Sita Admin",
      email: "sita@mvdugar.com",
      role: "BUSINESS_ADMIN",
      businessId: mahindra.id,
      monthlyCapUsd: "10",
    },
  });
  superAdmin = scopeFor(sup)!;
  mahindraAdmin = scopeFor(badmin)!;
  ram = await makeUser(db, mahindra.id);
  gita = await makeUser(db, finance.id);
});

const expectAdminError = async (p: Promise<unknown>, status: number) => {
  await expect(p).rejects.toBeInstanceOf(AdminError);
  await p.catch((e: AdminError) => expect(e.status).toBe(status));
};

describe("who is an admin", () => {
  it("only super and business admins get a scope, and not when deactivated", async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { id: ram.id } });
    expect(scopeFor(staff)).toBeNull();
    expect(
      scopeFor({ id: "x", role: "SUPER_ADMIN", status: "DEACTIVATED", businessId: null }),
    ).toBeNull();
    expect(
      scopeFor({ id: "x", role: "BUSINESS_ADMIN", status: "ACTIVE", businessId: null }),
    ).toBeNull();
  });
});

describe("business admins see only their own business", () => {
  it("in the overview, user list and business list", async () => {
    const o = await getOverview(db, mahindraAdmin);
    expect(o.businesses.map((b) => b.id)).toEqual([mahindra.id]);
    expect(o.people.every((p) => p.businessId === mahindra.id)).toBe(true);
    expect(o.people.map((p) => p.id)).not.toContain(gita.id);
    expect((await listUsers(db, mahindraAdmin)).map((u) => u.id)).not.toContain(gita.id);
    expect((await listBusinesses(db, mahindraAdmin)).map((b) => b.id)).toEqual([mahindra.id]);

    const all = await getOverview(db, superAdmin);
    expect(all.businesses.map((b) => b.id).sort()).toEqual([mahindra.id, finance.id].sort());
  });

  it("can change caps and pause their own staff", async () => {
    await updateUser(db, mahindraAdmin, ram.id, { monthlyCapUsd: "25", status: "PAUSED" });
    const u = await db.user.findUniqueOrThrow({ where: { id: ram.id } });
    expect(u.monthlyCapUsd.toString()).toBe("25");
    expect(u.status).toBe("PAUSED");
  });

  it("can't touch other businesses, roles, budgets or other admins", async () => {
    await expectAdminError(updateUser(db, mahindraAdmin, gita.id, { monthlyCapUsd: "99" }), 404);
    await expectAdminError(updateUser(db, mahindraAdmin, ram.id, { role: "BUSINESS_ADMIN" }), 403);
    await expectAdminError(updateUser(db, mahindraAdmin, ram.id, { businessId: finance.id }), 403);
    const sup = await db.user.findUniqueOrThrow({ where: { email: "super@mvdugar.com" } });
    await expectAdminError(updateUser(db, mahindraAdmin, sup.id, { status: "PAUSED" }), 403);
    await expectAdminError(
      updateBusiness(db, mahindraAdmin, mahindra.id, { monthlyBudgetUsd: "999" }),
      403,
    );
    await expectAdminError(
      createBusiness(db, mahindraAdmin, {
        name: "X",
        monthlyBudgetUsd: "1",
        allowedModels: ["claude-sonnet-5-5"],
      }),
      403,
    );
  });

  it("can add staff only to their own business", async () => {
    await createUser(db, mahindraAdmin, {
      name: "New Person",
      email: "new@mvdugar.com",
      businessId: mahindra.id,
    });
    await expectAdminError(
      createUser(db, mahindraAdmin, { name: "X", email: "x@mvdugar.com", businessId: finance.id }),
      403,
    );
    await expectAdminError(
      createUser(db, mahindraAdmin, {
        name: "X",
        email: "y@mvdugar.com",
        businessId: mahindra.id,
        role: "BUSINESS_ADMIN",
      }),
      403,
    );
  });
});

describe("safety rules", () => {
  it("nobody can pause, deactivate or demote themselves", async () => {
    await expectAdminError(
      updateUser(db, mahindraAdmin, mahindraAdmin.actorId, { status: "PAUSED" }),
      400,
    );
    await expectAdminError(updateUser(db, superAdmin, superAdmin.actorId, { role: "STAFF" }), 400);
  });

  it("the last super admin can't be removed", async () => {
    const second = await db.user.create({
      data: {
        name: "Second",
        email: "second@mvdugar.com",
        role: "SUPER_ADMIN",
        businessId: mahindra.id,
        monthlyCapUsd: "10",
      },
    });
    const secondScope = scopeFor(second)!;
    await updateUser(db, secondScope, superAdmin.actorId, { status: "DEACTIVATED" });
    await expectAdminError(updateUser(db, superAdmin, second.id, { status: "DEACTIVATED" }), 409);
  });

  it("deactivating someone signs them out everywhere", async () => {
    await db.session.create({
      data: { sessionToken: "t1", userId: ram.id, expires: new Date(Date.now() + 1e9) },
    });
    await updateUser(db, superAdmin, ram.id, { status: "DEACTIVATED" });
    expect(await db.session.count({ where: { userId: ram.id } })).toBe(0);
  });

  it("only company or allowlisted addresses can be added, and only once", async () => {
    await expectAdminError(
      createUser(db, superAdmin, { name: "X", email: "x@gmail.com", businessId: mahindra.id }),
      400,
    );
    await expectAdminError(
      createUser(db, superAdmin, {
        name: "X",
        email: ram.email.toUpperCase(),
        businessId: mahindra.id,
      }),
      409,
    );
  });

  it("validates amounts, models and the API key setting", async () => {
    await expectAdminError(updateUser(db, superAdmin, ram.id, { monthlyCapUsd: "-5" }), 400);
    await expectAdminError(updateUser(db, superAdmin, ram.id, { monthlyCapUsd: "ten" }), 400);
    await expectAdminError(
      updateBusiness(db, superAdmin, mahindra.id, { allowedModels: ["gpt-4"] }),
      400,
    );
    await expectAdminError(
      updateBusiness(db, superAdmin, mahindra.id, { apiKeyEnvVar: "DATABASE_URL" }),
      400,
    );
    await updateBusiness(db, superAdmin, mahindra.id, {
      apiKeyEnvVar: "ANTHROPIC_API_KEY_MAHINDRA",
    });
  });
});

describe("changes apply immediately and are audited", () => {
  it("a raised cap unblocks the user on their very next request", async () => {
    await db.usageEvent.create({
      data: {
        userId: ram.id,
        businessId: mahindra.id,
        requestedModel: "claude-sonnet-5-5",
        model: "claude-sonnet-5-5",
        costUsd: "10",
        status: "OK",
      },
    });
    const req = {
      userId: ram.id,
      model: "claude-sonnet-5-5",
      inputTokens: 1000,
      requestedMaxTokens: 16000,
      webSearch: false,
    };
    expect((await reserve(db, req, TEST_LIMITS)).ok).toBe(false);
    await updateUser(db, mahindraAdmin, ram.id, { monthlyCapUsd: "20" });
    expect((await reserve(db, req, TEST_LIMITS)).ok).toBe(true);
  });

  it("records who changed what, with old and new values", async () => {
    await updateUser(db, mahindraAdmin, ram.id, { monthlyCapUsd: "15", status: "PAUSED" });
    await updateBusiness(db, superAdmin, finance.id, { monthlyBudgetUsd: "75" });
    const all = await listAudit(db, superAdmin);
    expect(all.map((a) => a.action).sort()).toEqual([
      "business.budget_changed",
      "user.cap_changed",
      "user.paused",
    ]);
    const cap = all.find((a) => a.action === "user.cap_changed")!;
    expect(cap).toMatchObject({
      actorName: "Sita Admin",
      before: { capUsd: "10.00" },
      after: { capUsd: "15.00" },
    });
    // A business admin sees only their own business's entries.
    expect((await listAudit(db, mahindraAdmin)).map((a) => a.action).sort()).toEqual([
      "user.cap_changed",
      "user.paused",
    ]);
  });
});

describe("bulk add", () => {
  it("adds everyone from pasted CSV, or nobody if any line is wrong", async () => {
    const bad = await bulkCreateUsers(
      db,
      superAdmin,
      `name,email,business,cap\nHari,hari@mvdugar.com,${mahindra.name},12\nBad,bad@gmail.com,${mahindra.name},\nDup,hari@mvdugar.com,${mahindra.name},\nX,x@mvdugar.com,Nowhere,`,
    );
    expect(bad.created).toBe(0);
    expect(bad.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(await db.user.count({ where: { email: "hari@mvdugar.com" } })).toBe(0);

    const ok = await bulkCreateUsers(
      db,
      superAdmin,
      `Hari,hari@mvdugar.com,${mahindra.name},12\n"Thapa, Ram",ram.t@mvdugar.com,${finance.name.toUpperCase()},`,
    );
    expect(ok).toEqual({ created: 2, errors: [] });
    expect(
      (
        await db.user.findUniqueOrThrow({ where: { email: "hari@mvdugar.com" } })
      ).monthlyCapUsd.toString(),
    ).toBe("12");
    expect((await db.user.findUniqueOrThrow({ where: { email: "ram.t@mvdugar.com" } })).name).toBe(
      "Thapa, Ram",
    );
  });

  it("business admins can leave the business out (it's theirs) but can't name another", async () => {
    expect(await bulkCreateUsers(db, mahindraAdmin, "Asha,asha@mvdugar.com,,")).toEqual({
      created: 1,
      errors: [],
    });
    expect(
      (await bulkCreateUsers(db, mahindraAdmin, `B,b@mvdugar.com,${finance.name},`)).errors,
    ).toHaveLength(1);
  });
});

describe("admins never see message content", () => {
  it("overview, export, user list and audit contain no message text, titles or file names", async () => {
    const SECRET = "SECRET-LOAN-ACCOUNT-0042";
    const FILE = "customer-kyc-SECRET.pdf";
    await runChatTurn(
      { db, claudeFor: () => createMockClaude(), limits: TEST_LIMITS },
      {
        userId: ram.id,
        conversationId: null,
        model: "claude-sonnet-5-5",
        text: `Please summarise ${SECRET}`,
        attachments: await prepareAttachments([{ name: FILE, bytes: TINY_PDF }]),
      },
      () => {},
    );
    expect(await db.message.count()).toBe(2); // the content exists...

    const outputs = [
      await getOverview(db, superAdmin),
      await exportCsv(db, superAdmin, "people"),
      await exportCsv(db, superAdmin, "businesses"),
      await listUsers(db, superAdmin),
      await listBusinesses(db, superAdmin),
      await listAudit(db, superAdmin),
    ];
    const text = JSON.stringify(outputs);
    // ...but none of it reaches admin views.
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("summarise");
    expect(text).not.toContain("customer-kyc");
    expect(text).not.toContain("mock reply");
    // The request itself is visible as metadata.
    const o = outputs[0] as Awaited<ReturnType<typeof getOverview>>;
    expect(o.recent[0]).toMatchObject({ status: "OK", model: "claude-sonnet-5-5" });
    expect(Object.keys(o.recent[0]).sort()).toEqual(
      [
        "businessName",
        "cachedTokens",
        "costUsd",
        "createdAt",
        "durationMs",
        "errorCode",
        "id",
        "inputTokens",
        "model",
        "outputTokens",
        "status",
        "userName",
      ].sort(),
    );
  });
});

describe("overview numbers", () => {
  it("adds up spend, requests, active users and the month-end projection", async () => {
    const now = new Date("2026-11-16T00:00:00Z"); // half of November gone
    const ev = (
      userId: string,
      businessId: string,
      cost: string,
      status: "OK" | "BLOCKED" = "OK",
    ) =>
      db.usageEvent.create({
        data: {
          userId,
          businessId,
          requestedModel: "claude-sonnet-5-5",
          model: "claude-sonnet-5-5",
          costUsd: cost,
          status,
          createdAt: new Date("2026-11-10T00:00:00Z"),
        },
      });
    await ev(ram.id, mahindra.id, "3");
    await ev(ram.id, mahindra.id, "2");
    await ev(gita.id, finance.id, "5");
    await ev(gita.id, finance.id, "0", "BLOCKED");
    const o = await getOverview(db, superAdmin, now);
    expect(o.cards).toMatchObject({
      spentUsd: "10.00",
      projectedUsd: "20.00",
      activeUsers: 2,
      requests: 3,
      blockedRequests: 1,
    });
    expect(o.people.find((p) => p.id === ram.id)).toMatchObject({
      spentUsd: "5.00",
      capUsd: "10.00",
      percent: 50,
    });
    expect(o.businesses.find((b) => b.id === finance.id)).toMatchObject({
      spentUsd: "5.00",
      budgetUsd: "50.00",
      percent: 10,
    });

    const csv = await exportCsv(db, superAdmin, "businesses", now);
    expect(csv.split("\n")[0]).toBe(
      "month,business,spent_usd,budget_usd,percent_used,users,active",
    );
    expect(csv).toContain(`2026-11,${finance.name},5.00,50.00,10,1,yes`);
  });
});
