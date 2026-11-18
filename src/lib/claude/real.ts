import "server-only";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  ClaudeStreamError,
  type BetaContentBlock,
  type ClaudeClient,
  type ClaudeErrorKind,
  type ClaudeRequest,
} from "@/lib/claude/types";
import { combineUsage, toUsage } from "@/lib/claude/usage";
import type { ApiUsageWithIterations } from "@/lib/cost";

const BETAS = ["compact-2026-01-12"];
/** A server-tool loop (web search) can pause; we resume it at most this many times. */
const MAX_CONTINUATIONS = 2;

function baseParams(
  req: Omit<ClaudeRequest, "maxTokens" | "signal">,
  messages: BetaMessageParam[],
) {
  return {
    betas: BETAS,
    model: req.model,
    system: req.system,
    messages,
    ...(req.tools.length > 0 ? { tools: req.tools } : {}),
    // Summarise older turns server-side instead of failing when a chat gets long.
    context_management: {
      edits: [
        {
          type: "compact_20260112" as const,
          trigger: { type: "input_tokens" as const, value: req.compactAtTokens },
        },
      ],
    },
  };
}

export function classifyError(err: unknown): { kind: ClaudeErrorKind; code: string } {
  if (err instanceof Anthropic.APIUserAbortError) return { kind: "aborted", code: "aborted" };
  if (err instanceof Anthropic.RateLimitError)
    return { kind: "rate_limit", code: "rate_limit_error" };
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return { kind: "config", code: "authentication_error" };
  }
  if (err instanceof Anthropic.BadRequestError)
    return { kind: "invalid_request", code: "invalid_request_error" };
  if (err instanceof Anthropic.APIConnectionError)
    return { kind: "network", code: "connection_error" };
  if (err instanceof Anthropic.InternalServerError)
    return { kind: "overloaded", code: "overloaded_error" };
  if (err instanceof Anthropic.APIError) {
    // Errors that arrive mid-stream carry the API's error type, e.g. "overloaded_error".
    const type = (err.error as { error?: { type?: string } } | undefined)?.error?.type;
    if (type === "overloaded_error" || type === "api_error")
      return { kind: "overloaded", code: type };
    if (type === "rate_limit_error") return { kind: "rate_limit", code: type };
    return { kind: "unknown", code: type ?? `http_${err.status ?? "unknown"}` };
  }
  return { kind: "unknown", code: "unknown_error" };
}

export function createRealClaude(apiKey: string): ClaudeClient {
  // The SDK retries connection errors, 429s and 5xx with backoff before the stream starts.
  const client = new Anthropic({ apiKey, maxRetries: 3 });

  return {
    async countTokens(req) {
      const r = await client.beta.messages.countTokens(baseParams(req, req.messages), {
        timeout: 5_000,
        maxRetries: 1,
      });
      return r.input_tokens;
    },

    async stream(req, onEvent) {
      const content: BetaContentBlock[] = [];
      let total: { usage: ApiUsageWithIterations; model: string } | null = null;
      let messages = req.messages;
      let stopReason: string | null = null;

      for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
        const stream = client.beta.messages.stream(
          {
            ...baseParams(req, messages),
            max_tokens: req.maxTokens,
            output_config: { effort: req.effort },
            // Caches the conversation so far, so the next turn re-reads it at a fraction of the price.
            cache_control: { type: "ephemeral" },
            metadata: { user_id: req.userId },
          },
          { signal: req.signal },
        );
        stream.on("text", (text) => onEvent({ type: "text", text }));
        stream.on("streamEvent", (event) => {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "server_tool_use"
          ) {
            onEvent({ type: "status", status: "searching" });
          }
        });

        let message;
        try {
          message = await stream.finalMessage();
        } catch (err) {
          const partial = stream.currentMessage;
          const partialUsage = partial
            ? combineUsage(total, { usage: toUsage(partial.usage), model: partial.model })
            : (total?.usage ?? null);
          const { kind, code } = classifyError(err);
          throw new ClaudeStreamError(
            kind,
            code,
            partialUsage,
            [...content, ...((partial?.content as BetaContentBlock[] | undefined) ?? [])],
            partial?.model ?? total?.model ?? null,
          );
        }

        content.push(...(message.content as BetaContentBlock[]));
        total = {
          usage: combineUsage(total, { usage: toUsage(message.usage), model: message.model }),
          model: message.model,
        };
        stopReason = message.stop_reason;
        if (message.stop_reason !== "pause_turn") break;
        // Resume a paused server-tool loop: send the partial turn back, with no extra user message.
        messages = [...messages, { role: "assistant", content: message.content }];
      }

      return { content, usage: total!.usage, model: total!.model, stopReason };
    },

    async uploadFile({ bytes, name, mediaType }) {
      const meta = await client.files.upload({
        file: await toFile(bytes, name, { type: mediaType }),
      });
      return meta.id;
    },

    async deleteFile(fileId) {
      try {
        await client.files.delete(fileId);
      } catch (err) {
        if (!(err instanceof Anthropic.NotFoundError)) throw err;
      }
    },
  };
}
