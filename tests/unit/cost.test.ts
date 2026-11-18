import { describe, expect, it } from "vitest";
import {
  calculateCost,
  calculateCostSafe,
  maxAffordableOutputTokens,
  UnknownModelPricingError,
  upperBoundTokensForText,
  worstCaseCost,
} from "@/lib/cost";
import { MODEL_IDS } from "@/config/models";
import { PRICING } from "@/config/pricing";
import { formatCostShort, formatUsd, money } from "@/lib/money";

// Expected values are worked out by hand from the published per-MTok prices.
const total = (model: string, usage: Parameters<typeof calculateCost>[1]) =>
  calculateCost(model, usage).total.toString();

describe("every pickable model has a price", () => {
  it.each(MODEL_IDS)("%s", (id) => {
    expect(PRICING[id]).toBeDefined();
  });
});

describe("input and output prices per model", () => {
  it("Opus 5.5: $4 in / $20 out per MTok", () => {
    expect(total("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(
      "24",
    );
    expect(total("claude-opus-5-5", { input_tokens: 2_000, output_tokens: 500 })).toBe("0.018");
  });

  it("Sonnet 5.5: $2 in / $10 out per MTok (the spec's example reply)", () => {
    const c = calculateCost("claude-sonnet-5-5", { input_tokens: 1_240, output_tokens: 380 });
    expect(c.input.toString()).toBe("0.00248");
    expect(c.output.toString()).toBe("0.0038");
    expect(c.total.toString()).toBe("0.00628");
    expect(formatCostShort(c.total)).toBe("$0.006");
  });

  it("Haiku 5.5: $0.10 in / $0.50 out per MTok", () => {
    expect(total("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 100_000 })).toBe(
      "0.06",
    );
    expect(total("claude-haiku-5-5", { input_tokens: 10, output_tokens: 10 })).toBe("0.000006");
  });

  it("fallback models are priced too", () => {
    expect(total("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(
      "12",
    );
    expect(total("claude-opus-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(
      "30",
    );
  });
});

describe("Haiku 5.5 prompt-size tier (over 100,000 tokens costs 5x)", () => {
  it("exactly 100,000 prompt tokens stays in the cheap tier", () => {
    const c = calculateCost("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 1_000 });
    expect(c.highTier).toBe(false);
    expect(c.total.toString()).toBe("0.0105"); // 0.01 + 0.0005
  });

  it("100,001 prompt tokens moves every token, output included, to the high tier", () => {
    const c = calculateCost("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 1_000 });
    expect(c.highTier).toBe(true);
    expect(c.input.toString()).toBe("0.0500005");
    expect(c.output.toString()).toBe("0.0025");
    expect(c.total.toString()).toBe("0.0525005");
  });

  it("cache reads and writes count toward the 100,000 threshold", () => {
    const c = calculateCost("claude-haiku-5-5", {
      input_tokens: 50_000,
      output_tokens: 0,
      cache_read_input_tokens: 50_001,
    });
    expect(c.promptTokens).toBe(100_001);
    expect(c.highTier).toBe(true);
    expect(c.total.toString()).toBe("0.02750005"); // 0.025 + 0.00250005

    const w = calculateCost("claude-haiku-5-5", {
      input_tokens: 1,
      output_tokens: 0,
      cache_creation_input_tokens: 100_000,
    });
    expect(w.highTier).toBe(true);
    expect(w.cacheWrite.toString()).toBe("0.0625"); // 100,000 x $0.625
  });

  it("output tokens do not count toward the threshold", () => {
    const c = calculateCost("claude-haiku-5-5", { input_tokens: 90_000, output_tokens: 50_000 });
    expect(c.highTier).toBe(false);
  });

  it("other models have no tier (1M context at standard price)", () => {
    const c = calculateCost("claude-sonnet-5-5", { input_tokens: 500_000, output_tokens: 0 });
    expect(c.highTier).toBe(false);
    expect(c.total.toString()).toBe("1");
  });
});

describe("prompt caching", () => {
  it("prices cache writes at 1.25x and reads at 0.05x on Sonnet 5.5", () => {
    const c = calculateCost("claude-sonnet-5-5", {
      input_tokens: 100,
      output_tokens: 500,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 200_000,
    });
    expect(c.input.toString()).toBe("0.0002");
    expect(c.cacheWrite.toString()).toBe("0.025");
    expect(c.cacheRead.toString()).toBe("0.02");
    expect(c.output.toString()).toBe("0.005");
    expect(c.total.toString()).toBe("0.0502");
  });

  it("prices cache reads at 0.05x on Opus 5.5 and 0.1x on Haiku 5.5", () => {
    expect(
      total("claude-opus-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBe("0.2");
    expect(
      total("claude-haiku-5-5", {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 10_000,
      }),
    ).toBe("0.0001");
  });

  it("prices 1-hour cache writes at 2x when the API reports them", () => {
    const c = calculateCost("claude-opus-5-5", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 3_000,
      cache_creation: { ephemeral_5m_input_tokens: 2_000, ephemeral_1h_input_tokens: 1_000 },
    });
    expect(c.cacheWrite.toString()).toBe("0.018"); // 2,000 x $5 + 1,000 x $8
  });

  it("treats null cache fields as zero", () => {
    expect(
      total("claude-sonnet-5-5", {
        input_tokens: 1_000,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        server_tool_use: null,
      }),
    ).toBe("0.002");
  });
});

describe("web search", () => {
  it("charges $10 per 1,000 searches on top of tokens", () => {
    const c = calculateCost("claude-sonnet-5-5", {
      input_tokens: 1_000,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 3 },
    });
    expect(c.webSearch.toString()).toBe("0.03");
    expect(c.total.toString()).toBe("0.032");
  });
});

describe("bad and unknown input", () => {
  it("rejects negative or fractional token counts", () => {
    expect(() =>
      calculateCost("claude-sonnet-5-5", { input_tokens: -1, output_tokens: 0 }),
    ).toThrow();
    expect(() =>
      calculateCost("claude-sonnet-5-5", { input_tokens: 1.5, output_tokens: 0 }),
    ).toThrow();
  });

  it("refuses to guess a price for an unknown model", () => {
    expect(() => calculateCost("claude-new-model", { input_tokens: 1, output_tokens: 1 })).toThrow(
      UnknownModelPricingError,
    );
  });

  it("calculateCostSafe charges unknown models at the most expensive known price", () => {
    const c = calculateCostSafe("claude-new-model", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(c.unknownModel).toBe(true);
    expect(c.model).toBe("claude-new-model");
    expect(c.total.toString()).toBe("30"); // Opus 5 prices, the dearest configured
  });

  it("uses exact decimals: no floating-point drift over many small requests", () => {
    let sum = money(0);
    for (let i = 0; i < 10_000; i++) {
      sum = sum.plus(
        calculateCost("claude-haiku-5-5", { input_tokens: 10, output_tokens: 10 }).total,
      );
    }
    expect(sum.toString()).toBe("0.06");
  });
});

describe("worst-case estimate for the advance reservation", () => {
  it("prices every prompt token as a cache write and the full max_tokens as output", () => {
    // 10,000 x $2.50 + 16,000 x $10
    expect(
      worstCaseCost("claude-sonnet-5-5", {
        inputTokens: 10_000,
        maxOutputTokens: 16_000,
      }).toString(),
    ).toBe("0.185");
  });

  it("adds web searches and the tokens their results may add", () => {
    // (10,000 + 3 x 25,000) x $2.50 + 3 x $0.01 + 16,000 x $10
    const w = worstCaseCost("claude-sonnet-5-5", {
      inputTokens: 10_000,
      maxOutputTokens: 16_000,
      webSearchMaxUses: 3,
      webSearchInputAllowanceTokensPerSearch: 25_000,
    });
    expect(w.toString()).toBe("0.4025");
  });

  it("uses Haiku's high tier when search results could push the prompt past 100,000", () => {
    // 165,000 x $0.625 + $0.03 + 16,000 x $2.50
    const w = worstCaseCost("claude-haiku-5-5", {
      inputTokens: 90_000,
      maxOutputTokens: 16_000,
      webSearchMaxUses: 3,
      webSearchInputAllowanceTokensPerSearch: 25_000,
    });
    expect(w.toString()).toBe("0.173125");
  });

  it("is never below the actual cost of a request that fits it", () => {
    for (const model of MODEL_IDS) {
      const worst = worstCaseCost(model, { inputTokens: 50_000, maxOutputTokens: 16_000 });
      const actual = calculateCost(model, {
        input_tokens: 10_000,
        cache_creation_input_tokens: 30_000,
        cache_read_input_tokens: 10_000,
        output_tokens: 16_000,
      }).total;
      expect(worst.greaterThanOrEqualTo(actual)).toBe(true);
    }
  });
});

describe("shortening a reply to fit the remaining allowance", () => {
  it("returns how many output tokens the budget still covers", () => {
    // $0.10 - 10,000 x $2.50/MTok = $0.075 left, at $10/MTok = 7,500 tokens
    expect(
      maxAffordableOutputTokens("claude-sonnet-5-5", { inputTokens: 10_000 }, money("0.10")),
    ).toBe(7_500);
  });

  it("returns 0 when even the prompt doesn't fit", () => {
    expect(
      maxAffordableOutputTokens("claude-sonnet-5-5", { inputTokens: 10_000 }, money("0.02")),
    ).toBe(0);
  });
});

describe("token upper bound when counting fails", () => {
  it("counts UTF-8 bytes, which is never fewer than real tokens", () => {
    expect(upperBoundTokensForText("hello")).toBe(5);
    expect(upperBoundTokensForText("नमस्ते")).toBe(18); // Devanagari is 3 bytes per character
  });
});

describe("money formatting", () => {
  it("formats caps and costs the way the UI shows them", () => {
    expect(formatUsd("3.4")).toBe("USD 3.40");
    expect(formatUsd("10")).toBe("USD 10.00");
    expect(formatCostShort("0.0062")).toBe("$0.006");
    expect(formatCostShort("0.0004")).toBe("<$0.001");
    expect(formatCostShort("1.234")).toBe("$1.23");
    expect(formatCostShort("0")).toBe("$0.000");
  });

  it("refuses fractional JavaScript numbers", () => {
    expect(() => money(0.1)).toThrow();
  });
});
