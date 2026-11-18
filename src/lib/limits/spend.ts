// Month-to-date spend and open reservations. Accepts a transaction client so the
// reservation code can read these under its row locks.
import type { TransactionClient } from "@/generated/prisma/internal/prismaNamespace";
import { money, type Money } from "@/lib/money";
import type { BillingPeriod } from "@/lib/period";

type Scope = { userId: string } | { businessId: string };

/** Sum of settled usage costs in the period. */
export async function spentInPeriod(
  tx: TransactionClient,
  scope: Scope,
  period: BillingPeriod,
): Promise<Money> {
  const r = await tx.usageEvent.aggregate({
    _sum: { costUsd: true },
    where: { ...scope, createdAt: { gte: period.start, lt: period.end } },
  });
  return money(r._sum.costUsd);
}

/** Sum of reservations still open and not yet expired. */
export async function openReservations(
  tx: TransactionClient,
  scope: Scope,
  now: Date,
): Promise<Money> {
  const r = await tx.reservation.aggregate({
    _sum: { amountUsd: true },
    where: { ...scope, status: "OPEN", expiresAt: { gt: now } },
  });
  return money(r._sum.amountUsd);
}
