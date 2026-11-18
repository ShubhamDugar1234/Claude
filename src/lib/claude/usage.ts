import type { ApiUsageIteration, ApiUsageWithIterations } from "@/lib/cost";

interface SdkUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
  iterations?: ApiUsageIteration[] | null;
}

/** Normalises the SDK's usage object (whose fields can be null mid-stream). */
export function toUsage(u: SdkUsageLike | null | undefined): ApiUsageWithIterations {
  return {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
    server_tool_use: { web_search_requests: u?.server_tool_use?.web_search_requests ?? 0 },
    iterations: u?.iterations && u.iterations.length > 0 ? u.iterations : null,
  };
}

function asIterations(u: ApiUsageWithIterations, model: string): ApiUsageIteration[] {
  if (u.iterations && u.iterations.length > 0) return u.iterations;
  return [
    {
      type: "message",
      model,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
  ];
}

/**
 * Combines the usage of two API calls that together make one reply (a paused server-tool
 * turn and its continuation) so the cost calculation sees every step.
 */
export function combineUsage(
  a: { usage: ApiUsageWithIterations; model: string } | null,
  b: { usage: ApiUsageWithIterations; model: string },
): ApiUsageWithIterations {
  if (!a) return b.usage;
  const iterations = [...asIterations(a.usage, a.model), ...asIterations(b.usage, b.model)];
  return {
    ...b.usage,
    server_tool_use: {
      web_search_requests:
        (a.usage.server_tool_use?.web_search_requests ?? 0) +
        (b.usage.server_tool_use?.web_search_requests ?? 0),
    },
    iterations,
  };
}
