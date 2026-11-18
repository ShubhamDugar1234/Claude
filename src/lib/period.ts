// Billing periods. Stored and compared in UTC; shown to people in Asia/Kathmandu time.
import { Money, ZERO } from "@/lib/money";

export const DISPLAY_TIME_ZONE = "Asia/Kathmandu";

export interface BillingPeriod {
  /** Inclusive start, 00:00 UTC on the reset day. */
  start: Date;
  /** Exclusive end: the start of the next period. */
  end: Date;
}

function assertResetDay(resetDay: number) {
  if (!Number.isInteger(resetDay) || resetDay < 1 || resetDay > 28) {
    throw new Error(`Reset day must be 1–28, got ${resetDay}`);
  }
}

/**
 * The billing period containing `now`. With resetDay = 1 this is the calendar month in UTC,
 * matching Anthropic's billing. Reset days above 28 aren't allowed so every month has one.
 */
export function billingPeriod(now: Date, resetDay = 1): BillingPeriod {
  assertResetDay(resetDay);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  if (now.getUTCDate() < resetDay) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return {
    start: new Date(Date.UTC(year, month, resetDay)),
    end: new Date(Date.UTC(year, month + 1, resetDay)), // Date.UTC rolls month 12 into next year
  };
}

/** "1 December": the date allowances reset, as people in Nepal see it. */
export function formatResetDate(resetAt: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(resetAt);
}

/** "18 Nov 2026, 15:42": timestamps in tables, in Nepal time. */
export function formatDateTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(at);
}

/**
 * Linear projection of spend to the end of the period: spent ÷ fraction of period elapsed.
 * Before an hour has passed there's too little data, so we return what's been spent so far.
 */
export function projectPeriodEnd(spent: Money, period: BillingPeriod, now: Date): Money {
  const total = period.end.getTime() - period.start.getTime();
  const elapsed = Math.min(Math.max(now.getTime() - period.start.getTime(), 0), total);
  if (elapsed < 60 * 60 * 1000) return spent;
  if (spent.isZero()) return ZERO;
  return spent.times(total).dividedBy(elapsed).toDecimalPlaces(2, Money.ROUND_HALF_UP);
}
