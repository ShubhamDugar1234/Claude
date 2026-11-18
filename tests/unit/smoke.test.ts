import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// M0 smoke test: the generated client loads and Decimal arithmetic is exact.
describe("scaffold", () => {
  it("uses exact decimal arithmetic for money", () => {
    const a = new Prisma.Decimal("0.1");
    const b = new Prisma.Decimal("0.2");
    expect(a.plus(b).toString()).toBe("0.3");
  });
});
