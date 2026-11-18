// THE single place for Anthropic prices. All figures are USD per million tokens (MTok),
// written as strings so they're converted to exact decimals, never floats.
//
// Verified against https://platform.claude.com/docs/en/about-claude/pricing on 2026-11-18.
// When Anthropic changes prices, update this file (and PRICING_VERIFIED_ON) and run `npm test`.

export const PRICING_VERIFIED_ON = "2026-11-18";

export interface PriceTier {
  /**
   * This tier applies to requests whose prompt is at most this many tokens.
   * Prompt = input + cache write + cache read tokens. `null` means "no upper limit".
   * When a request falls in a higher tier, ALL its tokens (output too) use that tier's prices.
   */
  maxPromptTokens: number | null;
  inputPerMTok: string;
  outputPerMTok: string;
  /** Writing to the 5-minute prompt cache (1.25x input). The portal uses this one. */
  cacheWrite5mPerMTok: string;
  /** Writing to the 1-hour prompt cache (2x input). */
  cacheWrite1hPerMTok: string;
  /** Reading from the prompt cache. */
  cacheReadPerMTok: string;
}

export interface ModelPricing {
  /** Ordered from the lowest prompt size up; the last tier has maxPromptTokens: null. */
  tiers: PriceTier[];
}

export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-5-5": {
    tiers: [
      {
        maxPromptTokens: null,
        inputPerMTok: "4",
        outputPerMTok: "20",
        cacheWrite5mPerMTok: "5",
        cacheWrite1hPerMTok: "8",
        cacheReadPerMTok: "0.20", // 0.05x input on this model
      },
    ],
  },
  "claude-sonnet-5-5": {
    tiers: [
      {
        maxPromptTokens: null,
        inputPerMTok: "2",
        outputPerMTok: "10",
        cacheWrite5mPerMTok: "2.50",
        cacheWrite1hPerMTok: "4",
        cacheReadPerMTok: "0.10", // 0.05x input on this model
      },
    ],
  },
  "claude-haiku-5-5": {
    tiers: [
      {
        maxPromptTokens: 100_000,
        inputPerMTok: "0.10",
        outputPerMTok: "0.50",
        cacheWrite5mPerMTok: "0.125",
        cacheWrite1hPerMTok: "0.20",
        cacheReadPerMTok: "0.01",
      },
      {
        maxPromptTokens: null,
        inputPerMTok: "0.50",
        outputPerMTok: "2.50",
        cacheWrite5mPerMTok: "0.625",
        cacheWrite1hPerMTok: "1",
        cacheReadPerMTok: "0.05",
      },
    ],
  },

  // Models Anthropic may answer with when a request is refused and a fallback is enabled.
  // They are never offered in the picker, but their usage must still be priced.
  "claude-sonnet-5": {
    tiers: [
      {
        maxPromptTokens: null,
        inputPerMTok: "2",
        outputPerMTok: "10",
        cacheWrite5mPerMTok: "2.50",
        cacheWrite1hPerMTok: "4",
        cacheReadPerMTok: "0.20",
      },
    ],
  },
  "claude-opus-5": {
    tiers: [
      {
        maxPromptTokens: null,
        inputPerMTok: "5",
        outputPerMTok: "25",
        cacheWrite5mPerMTok: "6.25",
        cacheWrite1hPerMTok: "10",
        cacheReadPerMTok: "0.50",
      },
    ],
  },
};

/** Web search tool: USD per 1,000 searches (plus the tokens the results add, billed as input). */
export const WEB_SEARCH_PER_1000_USD = "10";
