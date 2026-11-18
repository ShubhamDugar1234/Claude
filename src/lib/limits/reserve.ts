// Spending limits without overspend under concurrency (SPEC 5.3).
//
// Before each Claude call we RESERVE the request's worst-case cost inside one transaction,
// holding row locks on the user and their business. Every request for the same business is
// therefore checked one at a time, so two simultaneous requests can never both squeeze under
// a cap. After the call we SETTLE: the reservation is swapped for the real cost (a UsageEvent).
// Settlement takes the same business lock, so a check never sees a request counted twice or
// not at all. Reservations left open (e.g. the server crashed) stop counting after 10 minutes.
//
// Everything is read fresh from the database on each request, so an admin's change to a cap,
// budget or status applies to the very next request.
import type { PrismaClient } from "@/generated/prisma/client";
import { TransactionIsolationLevel } from "@/generated/prisma/internal/prismaNamespace";
import type { TransactionClient } from "@/generated/prisma/internal/prismaNamespace";
import type { UsageStatus } from "@/generated/prisma/enums";
import { getLimits, type Limits } from "@/config/limits";
import {
  calculateCostSafe,
  maxAffordableOutputTokens,
  worstCaseCost,
  type ApiUsage,
} from "@/lib/cost";
import { minMoney, money, roundForStorage, type Money } from "@/lib/money";
import { billingPeriod, type BillingPeriod } from "@/lib/period";
import { openReservations, spentInPeriod } from "@/lib/limits/spend";
import type { BlockReason } from "@/lib/limits/reasons";

export type Db = PrismaClient;

export interface ReserveInput {
  userId: string;
  model: string;
  /** Prompt size from the token counting endpoint, or a safe upper bound. */
  inputTokens: number;
  /** The model's configured max_tokens. May be lowered to fit the remaining allowance. */
  requestedMaxTokens: number;
  /** Whether this request includes the web search tool. */
  webSearch: boolean;
  now?: Date;
}

export interface LimitContext {
  businessId: string | null;
  userCapUsd: Money | null;
  period: BillingPeriod;
}

export type ReserveResult =
  | (LimitContext & {
      ok: true;
      businessId: string;
      reservationId: string;
      amountUsd: Money;
      /** Use this as max_tokens for the call. Lower than requested if the allowance is nearly used up. */
      maxTokens: number;
    })
  | (LimitContext & { ok: false; reason: BlockReason });

const TX_OPTIONS = {
  isolationLevel: TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 15_000,
};

async function lockRow(tx: TransactionClient, table: "User" | "Business", id: string) {
  // Table names are fixed literals above, never user input.
  if (table === "User") await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT 1 FROM "Business" WHERE id = ${id} FOR UPDATE`;
}

export async function reserve(
  db: Db,
  input: ReserveInput,
  limits: Limits = getLimits(),
): Promise<ReserveResult> {
  const now = input.now ?? new Date();
  const period = billingPeriod(now, limits.billingResetDay);

  return db.$transaction(async (tx) => {
    // Lock order is always User then Business, everywhere, so transactions can't deadlock.
    await lockRow(tx, "User", input.userId);
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { status: true, businessId: true, monthlyCapUsd: true },
    });
    const base = {
      businessId: user?.businessId ?? null,
      userCapUsd: user ? money(user.monthlyCapUsd) : null,
      period,
    };
    const block = (reason: BlockReason): ReserveResult => ({ ...base, ok: false, reason });

    if (!user || user.status === "DEACTIVATED") return block("account_deactivated");
    if (user.status === "PAUSED") return block("account_paused");
    if (user.status === "PENDING" || !user.businessId) return block("account_pending");

    await lockRow(tx, "Business", user.businessId);
    const business = await tx.business.findUnique({
      where: { id: user.businessId },
      select: { active: true, monthlyBudgetUsd: true, allowedModels: true },
    });
    if (!business || !business.active) return block("business_inactive");
    if (!business.allowedModels.includes(input.model)) return block("model_not_allowed");

    const minuteAgo = new Date(now.getTime() - 60_000);
    const recent = await tx.reservation.count({
      where: { userId: input.userId, createdAt: { gt: minuteAgo } },
    });
    if (recent >= limits.rateLimitPerMinute) return block("rate_limited");

    const streaming = await tx.reservation.count({
      where: { userId: input.userId, status: "OPEN", expiresAt: { gt: now } },
    });
    if (streaming >= limits.maxConcurrentStreams) return block("too_many_streams");

    const userRemaining = money(user.monthlyCapUsd)
      .minus(await spentInPeriod(tx, { userId: input.userId }, period))
      .minus(await openReservations(tx, { userId: input.userId }, now));
    const businessRemaining = money(business.monthlyBudgetUsd)
      .minus(await spentInPeriod(tx, { businessId: user.businessId }, period))
      .minus(await openReservations(tx, { businessId: user.businessId }, now));

    if (userRemaining.lessThanOrEqualTo(0)) return block("user_cap_reached");
    if (businessRemaining.lessThanOrEqualTo(0)) return block("business_budget_reached");

    const estimate = {
      inputTokens: input.inputTokens,
      webSearchMaxUses: input.webSearch ? limits.webSearchMaxUses : 0,
      webSearchInputAllowanceTokensPerSearch: limits.webSearchInputAllowanceTokensPerSearch,
    };
    const headroom = minMoney(userRemaining, businessRemaining);
    let maxTokens = input.requestedMaxTokens;
    let amount = worstCaseCost(input.model, { ...estimate, maxOutputTokens: maxTokens });

    if (amount.greaterThan(headroom)) {
      // Not enough left for a full-length reply: shorten it to fit, if a useful reply still fits.
      const affordable = maxAffordableOutputTokens(input.model, estimate, headroom);
      if (affordable < limits.minOutputTokens) {
        return block(
          userRemaining.lessThanOrEqualTo(businessRemaining)
            ? "user_cap_reached"
            : "business_budget_reached",
        );
      }
      maxTokens = Math.min(maxTokens, affordable);
      amount = worstCaseCost(input.model, { ...estimate, maxOutputTokens: maxTokens });
    }

    const reservation = await tx.reservation.create({
      data: {
        userId: input.userId,
        businessId: user.businessId,
        amountUsd: roundForStorage(amount).toString(),
        expiresAt: new Date(now.getTime() + limits.reservationTtlMs),
        createdAt: now,
      },
      select: { id: true },
    });

    return {
      ...base,
      ok: true,
      businessId: user.businessId,
      reservationId: reservation.id,
      amountUsd: amount,
      maxTokens,
    };
  }, TX_OPTIONS);
}

export interface SettleInput {
  reservationId: string;
  conversationId?: string | null;
  requestedModel: string;
  /** The model the API reports it used (differs from requestedModel after a fallback). */
  model: string;
  /** null if the call failed before any tokens were used. */
  usage: ApiUsage | null;
  status: Exclude<UsageStatus, "BLOCKED">;
  errorCode?: string | null;
  durationMs: number;
  now?: Date;
}

export interface SettleResult {
  usageEventId: string;
  costUsd: Money;
  /** True if the model had no configured price and was charged at the dearest known price. */
  unknownModel: boolean;
}

/**
 * Replaces a reservation with the actual cost. Safe to call once per reservation; a second call
 * returns the first result. Usage is recorded even if the reservation already expired.
 */
export async function settle(db: Db, input: SettleInput): Promise<SettleResult> {
  const now = input.now ?? new Date();
  const priced = input.usage ? calculateCostSafe(input.model, input.usage) : null;
  const cost = priced ? roundForStorage(priced.total) : money(0);

  return db.$transaction(async (tx) => {
    const found = await tx.reservation.findUnique({
      where: { id: input.reservationId },
      select: { userId: true, businessId: true },
    });
    if (!found) throw new Error(`Reservation ${input.reservationId} not found`);

    // Same lock order as reserve(): User, then Business.
    await lockRow(tx, "User", found.userId);
    await lockRow(tx, "Business", found.businessId);

    const reservation = await tx.reservation.findUniqueOrThrow({
      where: { id: input.reservationId },
      select: { status: true, usageEventId: true },
    });
    if (reservation.status === "SETTLED" && reservation.usageEventId) {
      const existing = await tx.usageEvent.findUniqueOrThrow({
        where: { id: reservation.usageEventId },
        select: { costUsd: true },
      });
      return {
        usageEventId: reservation.usageEventId,
        costUsd: money(existing.costUsd),
        unknownModel: false,
      };
    }

    const u = input.usage;
    const event = await tx.usageEvent.create({
      data: {
        userId: found.userId,
        businessId: found.businessId,
        conversationId: input.conversationId ?? null,
        requestedModel: input.requestedModel,
        model: input.model,
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u?.cache_read_input_tokens ?? 0,
        webSearchCount: u?.server_tool_use?.web_search_requests ?? 0,
        costUsd: cost.toString(),
        status: input.status,
        errorCode: input.errorCode ?? null,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        createdAt: now,
      },
      select: { id: true },
    });

    await tx.reservation.update({
      where: { id: input.reservationId },
      data: { status: "SETTLED", settledAt: now, usageEventId: event.id },
    });
    await tx.user.update({ where: { id: found.userId }, data: { lastActiveAt: now } });

    return { usageEventId: event.id, costUsd: cost, unknownModel: priced?.unknownModel ?? false };
  }, TX_OPTIONS);
}

/**
 * Records a refused request (cost 0) so admins can see blocks in "Recent requests".
 * Rate-limit refusals are not recorded, so a stuck client can't flood the table.
 */
export async function recordBlocked(
  db: Db,
  input: {
    userId: string;
    businessId: string | null;
    model: string;
    reason: BlockReason;
    now?: Date;
  },
): Promise<void> {
  if (!input.businessId || input.reason === "rate_limited") return;
  await db.usageEvent.create({
    data: {
      userId: input.userId,
      businessId: input.businessId,
      requestedModel: input.model,
      model: input.model,
      costUsd: "0",
      status: "BLOCKED",
      errorCode: input.reason,
      createdAt: input.now ?? new Date(),
    },
  });
}

/** Housekeeping: marks open reservations past their expiry as EXPIRED. They already stopped counting. */
export async function expireStaleReservations(db: Db, now: Date = new Date()): Promise<number> {
  const r = await db.reservation.updateMany({
    where: { status: "OPEN", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return r.count;
}
