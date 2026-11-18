import { describe, expect, it } from "vitest";
import { billingPeriod, formatResetDate, projectPeriodEnd } from "@/lib/period";
import { money } from "@/lib/money";

const utc = (s: string) => new Date(s);

describe("billing period (UTC calendar month by default)", () => {
  it("is the calendar month containing now", () => {
    const p = billingPeriod(utc("2026-11-18T10:00:00Z"));
    expect(p.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("rolls over the year in December", () => {
    const p = billingPeriod(utc("2026-12-31T23:59:59Z"));
    expect(p.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("starts exactly at midnight UTC on the 1st", () => {
    expect(billingPeriod(utc("2026-12-01T00:00:00Z")).start.toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(billingPeriod(utc("2026-11-30T23:59:59.999Z")).start.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("uses UTC even when it's already the 1st in Nepal", () => {
    // 20:00 UTC on 30 Nov is 01:45 on 1 Dec in Kathmandu, but still November for billing.
    expect(billingPeriod(utc("2026-11-30T20:00:00Z")).start.toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
  });

  it("supports a configurable reset day", () => {
    const p = billingPeriod(utc("2027-01-03T00:00:00Z"), 15);
    expect(p.start.toISOString()).toBe("2026-12-15T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(billingPeriod(utc("2027-01-15T00:00:00Z"), 15).start.toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("rejects reset days that some months don't have", () => {
    expect(() => billingPeriod(new Date(), 29)).toThrow();
    expect(() => billingPeriod(new Date(), 0)).toThrow();
  });
});

describe("reset date shown to staff", () => {
  it("shows the Kathmandu date", () => {
    expect(formatResetDate(utc("2026-12-01T00:00:00Z"))).toBe("1 December");
  });
});

describe("month-end projection", () => {
  const nov = billingPeriod(utc("2026-11-10T00:00:00Z"));

  it("projects linearly from days elapsed", () => {
    // 15 of 30 days elapsed, $10 spent -> $20
    expect(projectPeriodEnd(money("10"), nov, utc("2026-11-16T00:00:00Z")).toString()).toBe("20");
  });

  it("returns spend so far in the first hour", () => {
    expect(projectPeriodEnd(money("1.5"), nov, utc("2026-11-01T00:30:00Z")).toString()).toBe("1.5");
  });

  it("equals spend at the end of the period", () => {
    expect(projectPeriodEnd(money("42"), nov, utc("2026-12-01T00:00:00Z")).toString()).toBe("42");
  });
});
