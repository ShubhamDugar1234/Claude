import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  expireStaleReservations,
  recordBlocked,
  reserve,
  settle,
  type ReserveInput,
} from "@/lib/limits/reserve";
import { money } from "@/lib/money";
import { createBusiness, createUser, makeDb, resetDb, TEST_LIMITS, type TestDb } from "./helpers";

// A Sonnet request with a 10,000-token prompt and 16,000 max_tokens has a worst case of
// 10,000 x $2.50/MTok + 16,000 x $10/MTok = $0.185.
const NOW = new Date("2026-11-18T06:00:00Z");
const req = (userId: string, extra: Partial<ReserveInput> = {}): ReserveInput => ({
  userId,
  model: "claude-sonnet-5-5",
  inputTokens: 10_000,
  requestedMaxTokens: 16_000,
  webSearch: false,
  now: NOW,
  ...extra,
});
const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

let db: TestDb;
beforeAll(() => {
  db = makeDb();
});
afterAll(async () => {
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
});

async function spend(userId: string, businessId: string, cost: string, createdAt = NOW) {
  await db.usageEvent.create({
    data: {
      userId,
      businessId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      costUsd: cost,
      status: "OK",
      createdAt,
    },
  });
}

async function openTotal(where: { userId: string } | { businessId: string }) {
  const r = await db.reservation.aggregate({
    _sum: { amountUsd: true },
    where: { ...where, status: "OPEN" },
  });
  return money(r._sum.amountUsd);
}

describe("reserve: happy path", () => {
  it("reserves the worst-case cost and returns the full max_tokens", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.maxTokens).toBe(16_000);
    expect(r.amountUsd.toString()).toBe("0.185");
    const row = await db.reservation.findUniqueOrThrow({ where: { id: r.reservationId } });
    expect(row.status).toBe("OPEN");
    expect(row.amountUsd.toString()).toBe("0.185");
    expect(row.expiresAt.toISOString()).toBe(minutes(10).toISOString());
  });
});

describe("reserve: account and business checks", () => {
  it.each([
    ["PAUSED", "account_paused"],
    ["DEACTIVATED", "account_deactivated"],
    ["PENDING", "account_pending"],
  ] as const)("blocks a %s user", async (status, reason) => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { status });
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    expect(r).toMatchObject({ ok: false, reason });
  });

  it("blocks a user with no business yet", async () => {
    const u = await createUser(db, null);
    expect(await reserve(db, req(u.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "account_pending",
    });
  });

  it("blocks an unknown user", async () => {
    expect(await reserve(db, req("nope"), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "account_deactivated",
    });
  });

  it("blocks everyone in an inactive business", async () => {
    const b = await createBusiness(db, { active: false });
    const u = await createUser(db, b.id);
    expect(await reserve(db, req(u.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "business_inactive",
    });
  });

  it("blocks models the business isn't allowed to use", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    expect(await reserve(db, req(u.id, { model: "claude-opus-5-5" }), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "model_not_allowed",
    });
  });
});

describe("reserve: user cap", () => {
  it("blocks once the cap is fully used", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "10" });
    await spend(u.id, b.id, "10");
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    expect(r).toMatchObject({ ok: false, reason: "user_cap_reached" });
    expect(r.userCapUsd?.toString()).toBe("10");
    expect(r.period.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("shortens the reply when a little allowance is left", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "10" });
    await spend(u.id, b.id, "9.90");
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // $0.10 left - $0.025 prompt = $0.075 -> 7,500 output tokens
    expect(r.maxTokens).toBe(7_500);
    expect(r.amountUsd.toString()).toBe("0.1");
  });

  it("blocks when what's left can't cover a useful reply", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "10" });
    await spend(u.id, b.id, "9.99");
    expect(await reserve(db, req(u.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "user_cap_reached",
    });
  });

  it("counts open reservations against the cap", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "0.40" });
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
    // $0.03 left: only 500 output tokens would fit, below the 2,048 minimum
    expect(await reserve(db, req(u.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "user_cap_reached",
    });
  });

  it("ignores reservations older than 10 minutes", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "0.20" });
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
    expect((await reserve(db, req(u.id, { now: minutes(5) }), TEST_LIMITS)).ok).toBe(false);
    expect((await reserve(db, req(u.id, { now: minutes(11) }), TEST_LIMITS)).ok).toBe(true);
  });

  it("doesn't count last month's spending", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "10" });
    await spend(u.id, b.id, "10", new Date("2026-10-31T23:59:59Z"));
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
  });

  it("applies an admin's cap change to the very next request", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "10" });
    await spend(u.id, b.id, "10");
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(false);
    await db.user.update({ where: { id: u.id }, data: { monthlyCapUsd: "20" } });
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
    await db.user.update({ where: { id: u.id }, data: { status: "PAUSED" } });
    expect(await reserve(db, req(u.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "account_paused",
    });
  });
});

describe("reserve: business budget", () => {
  it("blocks everyone in the business once its budget is used", async () => {
    const b = await createBusiness(db, { budget: "1" });
    const spender = await createUser(db, b.id, { cap: "50" });
    const other = await createUser(db, b.id, { cap: "50" });
    await spend(spender.id, b.id, "1");
    expect(await reserve(db, req(other.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "business_budget_reached",
    });
  });

  it("names the business budget when it is the tighter limit", async () => {
    const b = await createBusiness(db, { budget: "1" });
    const spender = await createUser(db, b.id, { cap: "50" });
    const other = await createUser(db, b.id, { cap: "50" });
    await spend(spender.id, b.id, "0.99");
    expect(await reserve(db, req(other.id), TEST_LIMITS)).toMatchObject({
      ok: false,
      reason: "business_budget_reached",
    });
  });
});

describe("reserve: rate and stream limits", () => {
  it("blocks requests over the per-minute limit until a minute passes", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "100" });
    const limits = { ...TEST_LIMITS, rateLimitPerMinute: 3 };
    for (let i = 0; i < 3; i++) {
      const r = await reserve(db, req(u.id), limits);
      expect(r.ok).toBe(true);
      if (r.ok)
        await settle(db, {
          reservationId: r.reservationId,
          requestedModel: "claude-sonnet-5-5",
          model: "claude-sonnet-5-5",
          usage: null,
          status: "OK",
          durationMs: 1,
          now: NOW,
        });
    }
    expect(await reserve(db, req(u.id), limits)).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
    expect((await reserve(db, req(u.id, { now: minutes(1.1) }), limits)).ok).toBe(true);
  });

  it("allows only 2 replies streaming at once", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "100" });
    const limits = { ...TEST_LIMITS, maxConcurrentStreams: 2 };
    const first = await reserve(db, req(u.id), limits);
    expect((await reserve(db, req(u.id), limits)).ok).toBe(true);
    expect(await reserve(db, req(u.id), limits)).toMatchObject({
      ok: false,
      reason: "too_many_streams",
    });
    if (!first.ok) throw new Error("expected ok");
    await settle(db, {
      reservationId: first.reservationId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 10, output_tokens: 10 },
      status: "OK",
      durationMs: 5,
      now: NOW,
    });
    expect((await reserve(db, req(u.id), limits)).ok).toBe(true);
  });
});

describe("reserve: no overspend under concurrency", () => {
  it("20 simultaneous requests from one user never exceed the cap", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "1" });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserve(db, req(u.id), TEST_LIMITS)),
    );
    const ok = results.filter((r) => r.ok);
    // 5 full requests ($0.925), then one shortened to fit the last $0.075.
    expect(ok).toHaveLength(6);
    const reserved = await openTotal({ userId: u.id });
    expect(reserved.lessThanOrEqualTo(1)).toBe(true);
    expect(reserved.toString()).toBe("1");
  });

  it("simultaneous requests from many users never exceed the business budget", async () => {
    const b = await createBusiness(db, { budget: "1" });
    const users = await Promise.all(
      Array.from({ length: 10 }, () => createUser(db, b.id, { cap: "50" })),
    );
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        reserve(db, req(users[i % users.length].id), TEST_LIMITS),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(0);
    expect((await openTotal({ businessId: b.id })).lessThanOrEqualTo(1)).toBe(true);
  });

  it("settlement racing new requests never lets spend + reservations exceed the cap", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "1" });
    const first = await Promise.all(
      Array.from({ length: 5 }, () => reserve(db, req(u.id), TEST_LIMITS)),
    );
    // Settle the first batch at their full worst case while more requests arrive.
    const work: Promise<unknown>[] = [];
    for (const r of first) {
      if (!r.ok) continue;
      work.push(
        settle(db, {
          reservationId: r.reservationId,
          requestedModel: "claude-sonnet-5-5",
          model: "claude-sonnet-5-5",
          usage: { input_tokens: 0, cache_creation_input_tokens: 10_000, output_tokens: 16_000 },
          status: "OK",
          durationMs: 1,
          now: NOW,
        }),
      );
      work.push(reserve(db, req(u.id), TEST_LIMITS));
    }
    await Promise.all(work);
    const spent = await db.usageEvent.aggregate({
      _sum: { costUsd: true },
      where: { userId: u.id },
    });
    const total = money(spent._sum.costUsd).plus(await openTotal({ userId: u.id }));
    expect(total.lessThanOrEqualTo(1)).toBe(true);
  });
});

describe("settle", () => {
  it("swaps the reservation for the real cost and frees the difference", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id, { cap: "0.40" });
    const r1 = await reserve(db, req(u.id), TEST_LIMITS);
    const r2 = await reserve(db, req(u.id), TEST_LIMITS);
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(false);
    if (!r1.ok || !r2.ok) throw new Error("expected ok");

    const s = await settle(db, {
      reservationId: r1.reservationId,
      conversationId: null,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1_240, output_tokens: 380 },
      status: "OK",
      durationMs: 1234,
      now: NOW,
    });
    expect(s.costUsd.toString()).toBe("0.00628");

    const event = await db.usageEvent.findUniqueOrThrow({ where: { id: s.usageEventId } });
    expect(event).toMatchObject({
      inputTokens: 1240,
      outputTokens: 380,
      status: "OK",
      durationMs: 1234,
    });
    const res = await db.reservation.findUniqueOrThrow({ where: { id: r1.reservationId } });
    expect(res).toMatchObject({ status: "SETTLED", usageEventId: s.usageEventId });
    const user = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user.lastActiveAt?.toISOString()).toBe(NOW.toISOString());

    // $0.40 - $0.00628 - $0.185 leaves room for another request.
    expect((await reserve(db, req(u.id), TEST_LIMITS)).ok).toBe(true);
  });

  it("is safe to call twice", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    if (!r.ok) throw new Error("expected ok");
    const input = {
      reservationId: r.reservationId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 100, output_tokens: 100 },
      status: "OK" as const,
      durationMs: 1,
      now: NOW,
    };
    const a = await settle(db, input);
    const c = await settle(db, input);
    expect(c.usageEventId).toBe(a.usageEventId);
    expect(await db.usageEvent.count()).toBe(1);
  });

  it("records a failed call with no usage at zero cost", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    if (!r.ok) throw new Error("expected ok");
    const s = await settle(db, {
      reservationId: r.reservationId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      usage: null,
      status: "ERROR",
      errorCode: "overloaded_error",
      durationMs: 50,
      now: NOW,
    });
    expect(s.costUsd.isZero()).toBe(true);
    expect(await db.usageEvent.findUniqueOrThrow({ where: { id: s.usageEventId } })).toMatchObject({
      status: "ERROR",
      errorCode: "overloaded_error",
    });
  });

  it("records the billed model after a fallback and charges unknown models at the dearest price", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    if (!r.ok) throw new Error("expected ok");
    const s = await settle(db, {
      reservationId: r.reservationId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-mystery-9",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
      status: "OK",
      durationMs: 1,
      now: NOW,
    });
    expect(s.unknownModel).toBe(true);
    expect(s.costUsd.toString()).toBe("5");
    expect(await db.usageEvent.findUniqueOrThrow({ where: { id: s.usageEventId } })).toMatchObject({
      requestedModel: "claude-sonnet-5-5",
      model: "claude-mystery-9",
    });
  });

  it("still records usage after the reservation expired", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    const r = await reserve(db, req(u.id), TEST_LIMITS);
    if (!r.ok) throw new Error("expected ok");
    expect(await expireStaleReservations(db, minutes(11))).toBe(1);
    const s = await settle(db, {
      reservationId: r.reservationId,
      requestedModel: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 1_000, output_tokens: 0 },
      status: "ABORTED",
      durationMs: 1,
      now: minutes(12),
    });
    expect(s.costUsd.toString()).toBe("0.002");
  });
});

describe("recordBlocked", () => {
  it("logs a blocked request at zero cost, but not rate-limit refusals", async () => {
    const b = await createBusiness(db);
    const u = await createUser(db, b.id);
    await recordBlocked(db, {
      userId: u.id,
      businessId: b.id,
      model: "claude-sonnet-5-5",
      reason: "user_cap_reached",
    });
    await recordBlocked(db, {
      userId: u.id,
      businessId: b.id,
      model: "claude-sonnet-5-5",
      reason: "rate_limited",
    });
    const events = await db.usageEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "BLOCKED", errorCode: "user_cap_reached" });
    expect(events[0].costUsd.toString()).toBe("0");
  });
});
