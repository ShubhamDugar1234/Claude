import { describe, expect, it } from "vitest";
import { BLOCK_REASONS, blockMessage, LASTING_BLOCKS } from "@/lib/limits/reasons";

describe("blocked-state messages", () => {
  it("matches the spec's wording for a used-up allowance", () => {
    expect(
      blockMessage("user_cap_reached", {
        userCapUsd: "10",
        resetAt: new Date("2026-12-01T00:00:00Z"),
      }),
    ).toBe(
      "You've used your monthly Claude allowance (USD 10.00). It resets on 1 December. Ask your manager or the ED's office if you need more.",
    );
  });

  it("gives every reason its own message", () => {
    const messages = BLOCK_REASONS.map((r) => blockMessage(r));
    expect(new Set(messages).size).toBe(BLOCK_REASONS.length);
  });

  it("treats rate limits as temporary and caps/pauses as lasting", () => {
    expect(LASTING_BLOCKS.has("rate_limited")).toBe(false);
    expect(LASTING_BLOCKS.has("too_many_streams")).toBe(false);
    expect(LASTING_BLOCKS.has("user_cap_reached")).toBe(true);
    expect(LASTING_BLOCKS.has("account_paused")).toBe(true);
  });
});
