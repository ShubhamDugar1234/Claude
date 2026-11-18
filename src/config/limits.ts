// Spending and usage limits. Values that an operator may want to change without
// editing code are read from environment variables (see .env.example).

export interface Limits {
  /** Monthly cap for new users, in USD. */
  defaultUserCapUsd: string;
  /** Day of the month (1–28, UTC) on which allowances reset. 1 matches Anthropic's billing month. */
  billingResetDay: number;
  /** Requests per user per minute. */
  rateLimitPerMinute: number;
  /** Replies a user can have streaming at the same time. */
  maxConcurrentStreams: number;
  /** An unsettled reservation stops counting after this long. */
  reservationTtlMs: number;
  /**
   * If a user's remaining allowance can't cover the full reply length, the reply is shortened to fit.
   * Below this many output tokens we block instead, because the reply would be useless.
   */
  minOutputTokens: number;
  /** Most web searches Claude may run for one reply (when the business has web search on). */
  webSearchMaxUses: number;
  /** Worst-case extra input tokens each web search can add, used only for the advance reservation. */
  webSearchInputAllowanceTokensPerSearch: number;
  /** Conversations older than this are deleted by the daily job. Usage records are kept. */
  retentionDays: number;
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
  }
  return n;
}

function usdFromEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+(\.\d{1,4})?$/.test(raw)) {
    throw new Error(`${name} must be a USD amount like 10 or 12.50 (got "${raw}")`);
  }
  return raw;
}

/** Read at call time so a changed env var (or a test override) takes effect without a rebuild. */
export function getLimits(): Limits {
  return {
    defaultUserCapUsd: usdFromEnv("DEFAULT_USER_CAP_USD", "10"),
    billingResetDay: intFromEnv("BILLING_RESET_DAY", 1, 1, 28),
    rateLimitPerMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 20, 1, 1000),
    maxConcurrentStreams: intFromEnv("MAX_CONCURRENT_STREAMS", 2, 1, 20),
    reservationTtlMs: 10 * 60 * 1000,
    minOutputTokens: 2_048,
    webSearchMaxUses: 3,
    webSearchInputAllowanceTokensPerSearch: 25_000,
    retentionDays: intFromEnv("RETENTION_DAYS", 180, 1, 3650),
  };
}
