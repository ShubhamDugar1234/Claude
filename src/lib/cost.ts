// Turns the `usage` object Anthropic returns into a USD cost, and estimates worst-case
// costs for the advance reservation. Never estimates from text length.
import {
  PRICING,
  WEB_SEARCH_PER_1000_USD,
  type ModelPricing,
  type PriceTier,
} from "@/config/pricing";
import { Money, money, ZERO } from "@/lib/money";

const PER_MTOK = new Money(1_000_000);

/** The parts of Anthropic's `usage` object that affect cost. Mirrors the API's snake_case names. */
export interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Split of cache writes by lifetime. If absent, all cache writes are treated as 5-minute writes. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export interface CostBreakdown {
  model: string;
  /** True if the request was priced at a model's higher prompt-size tier (Haiku over 100K). */
  highTier: boolean;
  promptTokens: number;
  input: Money;
  cacheWrite: Money;
  cacheRead: Money;
  output: Money;
  webSearch: Money;
  total: Money;
}

export class UnknownModelPricingError extends Error {
  constructor(public readonly model: string) {
    super(`No price configured for model "${model}". Add it to src/config/pricing.ts.`);
    this.name = "UnknownModelPricingError";
  }
}

export function hasPricing(model: string): boolean {
  return Object.hasOwn(PRICING, model);
}

export function getPricing(model: string): ModelPricing {
  if (!hasPricing(model)) throw new UnknownModelPricingError(model);
  return PRICING[model];
}

/** Picks the tier for a prompt of this size (prompt = input + cache write + cache read tokens). */
export function selectTier(pricing: ModelPricing, promptTokens: number): PriceTier {
  for (const tier of pricing.tiers) {
    if (tier.maxPromptTokens === null || promptTokens <= tier.maxPromptTokens) return tier;
  }
  throw new Error("Pricing tiers must end with a tier that has maxPromptTokens: null");
}

function nonNegInt(n: number | null | undefined, field: string): number {
  const v = n ?? 0;
  if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid usage.${field}: ${String(n)}`);
  return v;
}

function tokensCost(tokens: number, perMTok: string): Money {
  return money(tokens).times(money(perMTok)).dividedBy(PER_MTOK);
}

export function webSearchCost(searches: number): Money {
  return money(searches).times(money(WEB_SEARCH_PER_1000_USD)).dividedBy(1000);
}

/** Exact cost of one completed (or aborted) API call, from the usage the API reported. */
export function calculateCost(model: string, usage: ApiUsage): CostBreakdown {
  const pricing = getPricing(model);

  const inputTokens = nonNegInt(usage.input_tokens, "input_tokens");
  const outputTokens = nonNegInt(usage.output_tokens, "output_tokens");
  const cacheWriteTokens = nonNegInt(
    usage.cache_creation_input_tokens,
    "cache_creation_input_tokens",
  );
  const cacheReadTokens = nonNegInt(usage.cache_read_input_tokens, "cache_read_input_tokens");
  const searches = nonNegInt(usage.server_tool_use?.web_search_requests, "web_search_requests");

  // Split cache writes into 1-hour and 5-minute. Anything not reported as 1-hour is 5-minute.
  const write1h = Math.min(
    nonNegInt(usage.cache_creation?.ephemeral_1h_input_tokens, "ephemeral_1h_input_tokens"),
    cacheWriteTokens,
  );
  const write5m = cacheWriteTokens - write1h;

  const promptTokens = inputTokens + cacheWriteTokens + cacheReadTokens;
  const tier = selectTier(pricing, promptTokens);

  const input = tokensCost(inputTokens, tier.inputPerMTok);
  const cacheWrite = tokensCost(write5m, tier.cacheWrite5mPerMTok).plus(
    tokensCost(write1h, tier.cacheWrite1hPerMTok),
  );
  const cacheRead = tokensCost(cacheReadTokens, tier.cacheReadPerMTok);
  const output = tokensCost(outputTokens, tier.outputPerMTok);
  const webSearch = webSearchCost(searches);

  return {
    model,
    highTier: tier !== pricing.tiers[0],
    promptTokens,
    input,
    cacheWrite,
    cacheRead,
    output,
    webSearch,
    total: input.plus(cacheWrite).plus(cacheRead).plus(output).plus(webSearch),
  };
}

/**
 * Price of a model we have no price for (e.g. a new fallback model): charge as if it were
 * the most expensive configured model, so we never under-charge. Logged by the caller.
 */
export function mostExpensiveModelId(): string {
  let worstId: string | null = null;
  let worstOutput = ZERO;
  for (const [id, p] of Object.entries(PRICING)) {
    const out = money(p.tiers[p.tiers.length - 1].outputPerMTok);
    if (worstId === null || out.greaterThan(worstOutput)) {
      worstId = id;
      worstOutput = out;
    }
  }
  if (!worstId) throw new Error("No pricing configured");
  return worstId;
}

export function calculateCostSafe(
  model: string,
  usage: ApiUsage,
): CostBreakdown & { unknownModel: boolean } {
  if (hasPricing(model)) return { ...calculateCost(model, usage), unknownModel: false };
  return { ...calculateCost(mostExpensiveModelId(), usage), model, unknownModel: true };
}

export interface WorstCaseInput {
  /** Prompt size from the token counting endpoint, or a safe upper bound. */
  inputTokens: number;
  maxOutputTokens: number;
  /** 0 when web search is off. */
  webSearchMaxUses?: number;
  /** Extra input tokens each search may add (results are fed back to the model as input). */
  webSearchInputAllowanceTokensPerSearch?: number;
}

interface WorstCaseParts {
  tier: PriceTier;
  /** Everything except output tokens. */
  fixed: Money;
}

function worstCaseParts(model: string, w: WorstCaseInput): WorstCaseParts {
  const pricing = getPricing(model);
  const searches = nonNegInt(w.webSearchMaxUses ?? 0, "webSearchMaxUses");
  const promptTokens =
    nonNegInt(w.inputTokens, "inputTokens") +
    searches * nonNegInt(w.webSearchInputAllowanceTokensPerSearch ?? 0, "webSearchInputAllowance");
  const tier = selectTier(pricing, promptTokens);
  // Worst case for each prompt token is the dearest way it can be billed: as a cache write.
  const inputPerMTok = money(tier.cacheWrite5mPerMTok).greaterThan(money(tier.inputPerMTok))
    ? tier.cacheWrite5mPerMTok
    : tier.inputPerMTok;
  return { tier, fixed: tokensCost(promptTokens, inputPerMTok).plus(webSearchCost(searches)) };
}

/** Highest possible cost of a request, used for the advance reservation. */
export function worstCaseCost(model: string, w: WorstCaseInput): Money {
  const { tier, fixed } = worstCaseParts(model, w);
  return fixed.plus(
    tokensCost(nonNegInt(w.maxOutputTokens, "maxOutputTokens"), tier.outputPerMTok),
  );
}

/**
 * The longest reply (in output tokens) that fits in `budgetUsd`, given the prompt.
 * Returns 0 if even the prompt alone doesn't fit.
 */
export function maxAffordableOutputTokens(
  model: string,
  w: Omit<WorstCaseInput, "maxOutputTokens">,
  budgetUsd: Money,
): number {
  const { tier, fixed } = worstCaseParts(model, { ...w, maxOutputTokens: 0 });
  const left = budgetUsd.minus(fixed);
  if (left.lessThanOrEqualTo(0)) return 0;
  const perToken = money(tier.outputPerMTok).dividedBy(PER_MTOK);
  return left.dividedBy(perToken).floor().toNumber();
}

/**
 * Safe upper bound on the token count of some text when the token counting endpoint is
 * unavailable: one token per UTF-8 byte. Real tokenizers always produce fewer tokens than
 * bytes, for English and Devanagari alike, so this never under-estimates.
 */
export function upperBoundTokensForText(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
