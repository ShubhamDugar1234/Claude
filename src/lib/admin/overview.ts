// The "Usage & limits" numbers. Metadata only: costs, tokens, times, models and statuses.
import type { PrismaClient } from "@/generated/prisma/client";
import { getLimits } from "@/config/limits";
import { businessFilter, type AdminScope } from "@/lib/admin/scope";
import { money, ZERO, type Money } from "@/lib/money";
import { billingPeriod, projectPeriodEnd } from "@/lib/period";

export interface OverviewCards {
  spentUsd: string;
  projectedUsd: string;
  activeUsers: number;
  requests: number;
  blockedRequests: number;
  periodStart: string;
  periodEnd: string;
}

export interface BusinessRow {
  id: string;
  name: string;
  spentUsd: string;
  budgetUsd: string;
  percent: number;
  active: boolean;
  users: number;
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  businessId: string | null;
  businessName: string | null;
  role: string;
  status: string;
  spentUsd: string;
  capUsd: string;
  percent: number;
  lastActiveAt: string | null;
}

export interface RequestRow {
  id: string;
  createdAt: string;
  userName: string;
  businessName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: string;
  durationMs: number;
  status: string;
  errorCode: string | null;
}

function pct(spent: Money, limit: Money): number {
  if (limit.lessThanOrEqualTo(0)) return spent.greaterThan(0) ? 100 : 0;
  return spent.dividedBy(limit).times(100).floor().toNumber();
}

export async function getOverview(db: PrismaClient, scope: AdminScope, now = new Date()) {
  const period = billingPeriod(now, getLimits().billingResetDay);
  const inPeriod = { createdAt: { gte: period.start, lt: period.end } };
  const scoped = businessFilter(scope);

  const [businesses, people, byUser, byBusiness, counts, active, recent] = await Promise.all([
    db.business.findMany({
      where: scope.businessId ? { id: scope.businessId } : {},
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        monthlyBudgetUsd: true,
        active: true,
        _count: { select: { users: true } },
      },
    }),
    db.user.findMany({
      where: { ...scoped, status: { not: "DEACTIVATED" } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        monthlyCapUsd: true,
        lastActiveAt: true,
        businessId: true,
        business: { select: { name: true } },
      },
    }),
    db.usageEvent.groupBy({
      by: ["userId"],
      where: { ...scoped, ...inPeriod },
      _sum: { costUsd: true },
    }),
    db.usageEvent.groupBy({
      by: ["businessId"],
      where: { ...scoped, ...inPeriod },
      _sum: { costUsd: true },
    }),
    db.usageEvent.groupBy({
      by: ["status"],
      where: { ...scoped, ...inPeriod },
      _count: { _all: true },
    }),
    db.usageEvent.groupBy({ by: ["userId"], where: { ...scoped, ...inPeriod, status: "OK" } }),
    db.usageEvent.findMany({
      where: scoped,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
        costUsd: true,
        durationMs: true,
        status: true,
        errorCode: true,
        user: { select: { name: true } },
        business: { select: { name: true } },
      },
    }),
  ]);

  const userSpend = new Map(byUser.map((r) => [r.userId, money(r._sum.costUsd)]));
  const businessSpend = new Map(byBusiness.map((r) => [r.businessId, money(r._sum.costUsd)]));
  const total = byBusiness.reduce((sum, r) => sum.plus(money(r._sum.costUsd)), ZERO);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  const cards: OverviewCards = {
    spentUsd: total.toFixed(2),
    projectedUsd: projectPeriodEnd(total, period, now).toFixed(2),
    activeUsers: active.length,
    requests: count("OK") + count("ERROR") + count("ABORTED"),
    blockedRequests: count("BLOCKED"),
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
  };

  const businessRows: BusinessRow[] = businesses.map((b) => {
    const spent = businessSpend.get(b.id) ?? ZERO;
    const budget = money(b.monthlyBudgetUsd);
    return {
      id: b.id,
      name: b.name,
      spentUsd: spent.toFixed(2),
      budgetUsd: budget.toFixed(2),
      percent: pct(spent, budget),
      active: b.active,
      users: b._count.users,
    };
  });

  const personRows: PersonRow[] = people.map((u) => {
    const spent = userSpend.get(u.id) ?? ZERO;
    const cap = money(u.monthlyCapUsd);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      businessId: u.businessId,
      businessName: u.business?.name ?? null,
      role: u.role,
      status: u.status,
      spentUsd: spent.toFixed(2),
      capUsd: cap.toFixed(2),
      percent: pct(spent, cap),
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
    };
  });

  const requestRows: RequestRow[] = recent.map((e) => ({
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    userName: e.user.name,
    businessName: e.business.name,
    model: e.model,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    cachedTokens: e.cacheCreationTokens + e.cacheReadTokens,
    costUsd: money(e.costUsd).toFixed(4),
    durationMs: e.durationMs,
    status: e.status,
    errorCode: e.errorCode,
  }));

  return { cards, businesses: businessRows, people: personRows, recent: requestRows };
}

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** This month's usage as CSV: one row per person, or one row per business. */
export async function exportCsv(
  db: PrismaClient,
  scope: AdminScope,
  kind: "people" | "businesses",
  now = new Date(),
): Promise<string> {
  const o = await getOverview(db, scope, now);
  const month = o.cards.periodStart.slice(0, 7);
  const rows: (string | number | null)[][] =
    kind === "people"
      ? [
          [
            "month",
            "name",
            "email",
            "business",
            "role",
            "status",
            "spent_usd",
            "cap_usd",
            "percent_used",
            "last_active_utc",
          ],
          ...o.people.map((p) => [
            month,
            p.name,
            p.email,
            p.businessName,
            p.role,
            p.status,
            p.spentUsd,
            p.capUsd,
            p.percent,
            p.lastActiveAt,
          ]),
        ]
      : [
          ["month", "business", "spent_usd", "budget_usd", "percent_used", "users", "active"],
          ...o.businesses.map((b) => [
            month,
            b.name,
            b.spentUsd,
            b.budgetUsd,
            b.percent,
            b.users,
            b.active ? "yes" : "no",
          ]),
        ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
