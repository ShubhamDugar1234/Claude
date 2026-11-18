// Exact decimal money. Never use JavaScript numbers for USD amounts.
import DecimalJs from "decimal.js";

/** Decimal class configured for money: plenty of precision, half-up rounding. */
export const Money = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Money = InstanceType<typeof Money>;

/** Anything we may receive as an amount: a string, a Decimal (ours or Prisma's), or null. */
export type MoneyInput = string | number | Money | { toString(): string } | null | undefined;

export function money(value: MoneyInput): Money {
  if (value === null || value === undefined) return new Money(0);
  if (typeof value === "number") {
    // Integers are safe (token counts, cents). Fractions must arrive as strings.
    if (!Number.isInteger(value)) throw new Error("Pass fractional money as a string, not a float");
    return new Money(value);
  }
  return new Money(value.toString());
}

export const ZERO = new Money(0);

/** Rounding used when a cost is written to the database (Decimal(14, 8)). */
export function roundForStorage(value: Money): Money {
  return value.toDecimalPlaces(8, Money.ROUND_HALF_UP);
}

export function minMoney(a: Money, b: Money): Money {
  return a.lessThan(b) ? a : b;
}

/** "USD 3.40": used for caps, budgets and the allowance meter. */
export function formatUsd(value: MoneyInput): string {
  return `USD ${money(value).toFixed(2, Money.ROUND_HALF_UP)}`;
}

/**
 * Short cost shown under each reply, e.g. "$0.006".
 * Under $1 we show 3 decimals (most replies cost fractions of a cent); tiny amounts show "<$0.001".
 */
export function formatCostShort(value: MoneyInput): string {
  const d = money(value);
  if (d.isZero()) return "$0.000";
  if (d.lessThan("0.001")) return "<$0.001";
  if (d.lessThan(1)) return `$${d.toFixed(3, Money.ROUND_HALF_UP)}`;
  return `$${d.toFixed(2, Money.ROUND_HALF_UP)}`;
}
