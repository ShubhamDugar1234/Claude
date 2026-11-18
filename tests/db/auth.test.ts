import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canSendCode, issueLoginCode, verifyLoginCode } from "@/lib/auth/login-codes";
import { checkSignIn } from "@/lib/auth/sign-in-policy";
import { portalAdapter } from "@/lib/auth/adapter";
import { seed, BUSINESSES } from "../../prisma/seed";
import { createBusiness, createUser, makeDb, resetDb, type TestDb } from "./helpers";

const NOW = new Date("2026-11-18T06:00:00Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const EMAIL = "ram@mvdugar.com";

let db: TestDb;
const savedEnv = { ...process.env };
beforeAll(() => {
  db = makeDb();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.AUTO_PROVISION;
  await resetDb(db);
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("login codes", () => {
  it("a correct code returns the Auth.js token, once", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "long-token", now: NOW });
    expect(await verifyLoginCode(db, { email: EMAIL, code, now: later(1) })).toEqual({
      ok: true,
      authToken: "long-token",
    });
    expect(await verifyLoginCode(db, { email: EMAIL, code, now: later(2) })).toMatchObject({
      ok: false,
    });
  });

  it("the code is never stored in plain text", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "t", now: NOW });
    const row = await db.loginCode.findFirstOrThrow();
    expect(row.codeHash).not.toContain(code);
  });

  it("allows 5 wrong tries, then the code stops working even if correct", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "t", now: NOW });
    const wrong = code === "000000" ? "111111" : "000000";
    const left: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await verifyLoginCode(db, { email: EMAIL, code: wrong, now: NOW });
      if (!r.ok && r.reason === "wrong_code") left.push(r.attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1]);
    expect(await verifyLoginCode(db, { email: EMAIL, code: wrong, now: NOW })).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
    expect(await verifyLoginCode(db, { email: EMAIL, code, now: NOW })).toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
  });

  it("parallel guesses are all counted", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "t", now: NOW });
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(
      Array.from({ length: 10 }, () =>
        verifyLoginCode(db, { email: EMAIL, code: wrong, now: NOW }),
      ),
    );
    const row = await db.loginCode.findFirstOrThrow();
    expect(row.attempts).toBe(5);
  });

  it("expires after 10 minutes", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "t", now: NOW });
    expect(await verifyLoginCode(db, { email: EMAIL, code, now: later(10) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("a new code replaces the old one", async () => {
    const first = await issueLoginCode(db, { email: EMAIL, authToken: "t1", now: NOW });
    const second = await issueLoginCode(db, { email: EMAIL, authToken: "t2", now: later(1) });
    if (first !== second) {
      expect((await verifyLoginCode(db, { email: EMAIL, code: first, now: later(2) })).ok).toBe(
        false,
      );
    }
    expect(await verifyLoginCode(db, { email: EMAIL, code: second, now: later(2) })).toMatchObject({
      ok: true,
      authToken: "t2",
    });
  });

  it("a code for one address doesn't work for another", async () => {
    const code = await issueLoginCode(db, { email: EMAIL, authToken: "t", now: NOW });
    await issueLoginCode(db, { email: "sita@mvdugar.com", authToken: "t2", now: NOW });
    const r = await verifyLoginCode(db, { email: "sita@mvdugar.com", code, now: NOW });
    // Only passes if the two random codes happened to be equal (1 in a million).
    if (r.ok) expect(r.authToken).toBe("t2");
    else expect(r.reason).toBe("wrong_code");
  });

  it("sends at most 5 codes per address per hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await canSendCode(db, EMAIL, later(i))).toBe(true);
      await issueLoginCode(db, { email: EMAIL, authToken: `t${i}`, now: later(i) });
    }
    expect(await canSendCode(db, EMAIL, later(10))).toBe(false);
    expect(await canSendCode(db, EMAIL, later(61))).toBe(true);
  });
});

describe("sign-in policy", () => {
  it("refuses other domains, unknown and deactivated users", async () => {
    const b = await createBusiness(db);
    const deact = await createUser(db, b.id, { status: "DEACTIVATED" });
    expect(await checkSignIn(db, "ram@gmail.com")).toEqual({
      ok: false,
      reason: "not_company_email",
    });
    expect(await checkSignIn(db, "nobody@mvdugar.com")).toEqual({ ok: false, reason: "not_added" });
    expect(await checkSignIn(db, deact.email)).toEqual({ ok: false, reason: "deactivated" });
  });

  it("lets active, paused and pending users sign in", async () => {
    const b = await createBusiness(db);
    for (const status of ["ACTIVE", "PAUSED", "PENDING"] as const) {
      const u = await createUser(db, b.id, { status });
      expect(await checkSignIn(db, u.email.toUpperCase())).toMatchObject({
        ok: true,
        exists: true,
      });
    }
  });

  it("lets unknown company addresses in only when AUTO_PROVISION is on", async () => {
    process.env.AUTO_PROVISION = "true";
    expect(await checkSignIn(db, "new@mvdugar.com")).toEqual({
      ok: true,
      email: "new@mvdugar.com",
      exists: false,
    });
    expect(await checkSignIn(db, "new@gmail.com")).toMatchObject({ ok: false });
  });
});

describe("auth adapter", () => {
  it("won't create users unless AUTO_PROVISION is on, and then only as PENDING", async () => {
    const adapter = portalAdapter(db);
    const draft = { id: "x", email: "new.person@mvdugar.com", emailVerified: null };
    await expect(Promise.resolve(adapter.createUser!(draft))).rejects.toThrow();
    process.env.AUTO_PROVISION = "true";
    await adapter.createUser!(draft);
    const u = await db.user.findUniqueOrThrow({ where: { email: "new.person@mvdugar.com" } });
    expect(u).toMatchObject({
      status: "PENDING",
      role: "STAFF",
      businessId: null,
      name: "New Person",
    });
    expect(u.monthlyCapUsd.toString()).toBe("10");
  });

  it("ends a deactivated user's sessions immediately", async () => {
    const adapter = portalAdapter(db);
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    await adapter.createSession!({ sessionToken: "s1", userId: u.id, expires: later(60 * 24) });
    expect(await adapter.getSessionAndUser!("s1")).not.toBeNull();
    await db.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } });
    expect(await adapter.getSessionAndUser!("s1")).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("verification tokens work once", async () => {
    const adapter = portalAdapter(db);
    await adapter.createVerificationToken!({
      identifier: EMAIL,
      token: "hash",
      expires: later(10),
    });
    expect(await adapter.useVerificationToken!({ identifier: EMAIL, token: "hash" })).toMatchObject(
      { identifier: EMAIL },
    );
    expect(await adapter.useVerificationToken!({ identifier: EMAIL, token: "hash" })).toBeNull();
  });

  it("never lets a sign-in overwrite an admin-set name", async () => {
    const adapter = portalAdapter(db);
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    await adapter.updateUser!({ id: u.id, name: "Google Name", emailVerified: NOW });
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.name).toBe(u.name);
    expect(after.emailVerified?.toISOString()).toBe(NOW.toISOString());
  });
});

describe("seed", () => {
  it("creates the 11 businesses and the super admin, and is safe to re-run", async () => {
    await seed(db);
    expect(await db.business.count()).toBe(BUSINESSES.length);
    const group = await db.business.findUniqueOrThrow({ where: { name: "Group / ED Office" } });
    expect(group.allowedModels).toContain("claude-opus-5-5");
    const mahindra = await db.business.findUniqueOrThrow({ where: { name: "Mahindra" } });
    expect(mahindra.allowedModels).not.toContain("claude-opus-5-5");
    const admin = await db.user.findUniqueOrThrow({ where: { email: "shubham@mvdugar.com" } });
    expect(admin).toMatchObject({ role: "SUPER_ADMIN", status: "ACTIVE", businessId: group.id });

    await db.business.update({ where: { id: mahindra.id }, data: { monthlyBudgetUsd: "75" } });
    await seed(db);
    expect(
      (
        await db.business.findUniqueOrThrow({ where: { id: mahindra.id } })
      ).monthlyBudgetUsd.toString(),
    ).toBe("75");
    expect(await db.business.count()).toBe(BUSINESSES.length);
  });
});
