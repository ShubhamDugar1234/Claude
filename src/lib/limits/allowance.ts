// What the allowance meter shows, and whether chat is blocked right now (for disabling the input).
import type { PrismaClient } from "@/generated/prisma/client";
import { getLimits, type Limits } from "@/config/limits";
import { money, type Money } from "@/lib/money";
import { billingPeriod } from "@/lib/period";
import { blockMessage, type BlockReason } from "@/lib/limits/reasons";

export interface Allowance {
  spentUsd: string;
  capUsd: string;
  /** 0–100+, rounded down. */
  percent: number;
  businessSpentUsd: string;
  businessBudgetUsd: string;
  businessPercent: number;
  /** When allowances reset (ISO, UTC). */
  resetAt: string;
  block: { reason: BlockReason; message: string } | null;
}

function pct(spent: Money, limit: Money): number {
  if (limit.lessThanOrEqualTo(0)) return 100;
  return spent.dividedBy(limit).times(100).floor().toNumber();
}

export async function getAllowance(
  db: PrismaClient,
  userId: string,
  now = new Date(),
  limits: Limits = getLimits(),
): Promise<Allowance | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      monthlyCapUsd: true,
      businessId: true,
      business: { select: { active: true, monthlyBudgetUsd: true } },
    },
  });
  if (!user) return null;
  const period = billingPeriod(now, limits.billingResetDay);
  const inPeriod = { gte: period.start, lt: period.end };

  const [mine, business] = await Promise.all([
    db.usageEvent.aggregate({ _sum: { costUsd: true }, where: { userId, createdAt: inPeriod } }),
    user.businessId
      ? db.usageEvent.aggregate({
          _sum: { costUsd: true },
          where: { businessId: user.businessId, createdAt: inPeriod },
        })
      : null,
  ]);
  const spent = money(mine._sum.costUsd);
  const cap = money(user.monthlyCapUsd);
  const bizSpent = money(business?._sum.costUsd);
  const budget = money(user.business?.monthlyBudgetUsd);

  let reason: BlockReason | null = null;
  if (user.status === "DEACTIVATED") reason = "account_deactivated";
  else if (user.status === "PAUSED") reason = "account_paused";
  else if (user.status === "PENDING" || !user.business) reason = "account_pending";
  else if (!user.business.active) reason = "business_inactive";
  else if (spent.greaterThanOrEqualTo(cap)) reason = "user_cap_reached";
  else if (bizSpent.greaterThanOrEqualTo(budget)) reason = "business_budget_reached";

  return {
    spentUsd: spent.toFixed(2),
    capUsd: cap.toFixed(2),
    percent: pct(spent, cap),
    businessSpentUsd: bizSpent.toFixed(2),
    businessBudgetUsd: budget.toFixed(2),
    businessPercent: pct(bizSpent, budget),
    resetAt: period.end.toISOString(),
    block: reason
      ? {
          reason,
          message: blockMessage(reason, { userCapUsd: cap, resetAt: period.end }),
        }
      : null,
  };
}
