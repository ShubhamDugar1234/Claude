// One chat turn, end to end: check limits and reserve, call Claude, stream to the browser,
// save the reply, and settle the real cost. Framework-free so it can be tested directly.
//
// Guarantees:
// - A reservation, once made, is always settled (success, error or Stop), or expires in 10 min.
// - Usage records never contain message text; errors are logged by code only.
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  BetaUserMessageParam,
  BetaWebSearchTool20260209,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getLimits, type Limits } from "@/config/limits";
import { isModelId, MODELS } from "@/config/models";
import { DEFAULT_SYSTEM_PROMPT, SYSTEM_PROMPT_SETTING_KEY } from "@/config/prompts";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { textBlocksOnly, titleFromText, toApiMessages } from "@/lib/chat/conversations";
import {
  ClaudeStreamError,
  type BetaContentBlock,
  type BetaMessageParam,
  type ClaudeClient,
  type ClaudeErrorKind,
} from "@/lib/claude/types";
import { upperBoundTokensForText, type ApiUsageWithIterations } from "@/lib/cost";
import { formatCostShort } from "@/lib/money";
import { getAllowance, type Allowance } from "@/lib/limits/allowance";
import { blockMessage, LASTING_BLOCKS, type BlockReason } from "@/lib/limits/reasons";
import { recordBlocked, reserve, settle } from "@/lib/limits/reserve";

export const MAX_MESSAGE_CHARS = 100_000;

/** Events sent to the browser over SSE. */
export type ChatStreamEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; text: string }
  | { type: "status"; status: "searching" }
  | {
      type: "done";
      messageId: string;
      usage: { inputTokens: number; outputTokens: number; cost: string };
      notice: string | null;
      allowance: Allowance | null;
    }
  | {
      type: "blocked";
      reason: BlockReason;
      message: string;
      lasting: boolean;
      allowance: Allowance | null;
    }
  | { type: "error"; message: string; allowance: Allowance | null };

export interface ChatTurnInput {
  userId: string;
  conversationId: string | null;
  model: string;
  /** The user's message as API content blocks (text, and later documents/images). */
  content: BetaUserMessageParam["content"];
  /** Plain text of the message, for the title and token estimate fallback. */
  text: string;
  signal?: AbortSignal;
}

export interface ChatDeps {
  db: PrismaClient;
  /** Returns the Claude client for a business's API key env var. May throw MissingApiKeyError. */
  claudeFor: (apiKeyEnvVar: string) => ClaudeClient;
  limits?: Limits;
  now?: () => Date;
}

export function friendlyError(kind: ClaudeErrorKind | "missing_key"): string {
  switch (kind) {
    case "rate_limit":
      return "Claude is getting too many requests right now. Please wait a minute and try again.";
    case "overloaded":
      return "Claude is very busy at the moment. Please try again in a little while.";
    case "network":
      return "We couldn't reach Claude. Please check your connection and try again.";
    case "invalid_request":
      return "Claude couldn't process this message. It may be too long, or contain something it can't read.";
    case "config":
    case "missing_key":
      return "The portal's connection to Claude isn't set up correctly. Please tell the ED's office.";
    case "aborted":
      return "Stopped.";
    default:
      return "Something went wrong while Claude was replying. Please try again.";
  }
}

function stopNotice(stopReason: string | null, shortened: boolean): string | null {
  switch (stopReason) {
    case "refusal":
      return "Claude declined to answer this request.";
    case "max_tokens":
      return shortened
        ? "This reply was cut short because your monthly allowance is nearly used up."
        : "This reply reached the maximum length. Ask Claude to continue if you need more.";
    case "model_context_window_exceeded":
      return "This conversation has become too long. Please start a new chat.";
    default:
      return null;
  }
}

async function systemPromptBase(db: PrismaClient): Promise<string> {
  const s = await db.setting.findUnique({ where: { key: SYSTEM_PROMPT_SETTING_KEY } });
  return typeof s?.value === "string" && s.value.trim() ? s.value : DEFAULT_SYSTEM_PROMPT;
}

export async function runChatTurn(
  deps: ChatDeps,
  input: ChatTurnInput,
  emit: (event: ChatStreamEvent) => void,
): Promise<void> {
  const { db } = deps;
  const limits = deps.limits ?? getLimits();
  const now = deps.now ?? (() => new Date());
  const allowance = () => getAllowance(db, input.userId, now(), limits);
  const fail = async (message: string) =>
    emit({ type: "error", message, allowance: await allowance() });

  if (!isModelId(input.model)) return fail("Please choose a model from the list.");
  const modelConfig = MODELS[input.model];

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: {
      name: true,
      business: {
        select: { name: true, apiKeyEnvVar: true, extraSystemPrompt: true, webSearchEnabled: true },
      },
    },
  });
  if (!user) return fail("Your account wasn't found. Please sign in again.");

  // History, if continuing a conversation the user owns.
  let history: BetaMessageParam[] = [];
  if (input.conversationId) {
    const own = await db.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId, deletedAt: null },
      select: { id: true },
    });
    if (!own) return fail("This conversation no longer exists.");
    const rows = await db.message.findMany({
      where: { conversationId: own.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    history = toApiMessages(rows);
  }

  const messages: BetaMessageParam[] = [...history, { role: "user", content: input.content }];
  const system = user.business
    ? buildSystemPrompt({
        basePrompt: await systemPromptBase(db),
        businessName: user.business.name,
        businessExtra: user.business.extraSystemPrompt,
        userFirstName: user.name.split(" ")[0],
        now: now(),
      })
    : [];
  const webSearch = !!user.business?.webSearchEnabled;
  const tools: BetaWebSearchTool20260209[] = webSearch
    ? [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: limits.webSearchMaxUses,
          user_location: { type: "approximate", country: "NP", timezone: "Asia/Kathmandu" },
        },
      ]
    : [];

  let claude: ClaudeClient | null = null;
  try {
    if (user.business) claude = deps.claudeFor(user.business.apiKeyEnvVar);
  } catch {
    console.error("[chat] no Anthropic API key configured for business");
  }

  // Prompt size for the worst-case reservation: exact count, or a safe upper bound.
  let inputTokens: number;
  try {
    if (!claude) throw new Error("no client");
    inputTokens = await claude.countTokens({
      model: input.model,
      effort: modelConfig.effort,
      system,
      messages,
      tools,
      compactAtTokens: modelConfig.compactAtTokens,
      userId: input.userId,
    });
  } catch {
    inputTokens = upperBoundTokensForText(JSON.stringify([system, messages]));
  }

  const reservation = await reserve(
    db,
    {
      userId: input.userId,
      model: input.model,
      inputTokens,
      requestedMaxTokens: modelConfig.maxTokens,
      webSearch,
      now: now(),
    },
    limits,
  );
  if (!reservation.ok) {
    await recordBlocked(db, {
      userId: input.userId,
      businessId: reservation.businessId,
      model: input.model,
      reason: reservation.reason,
      now: now(),
    });
    emit({
      type: "blocked",
      reason: reservation.reason,
      message: blockMessage(reservation.reason, {
        userCapUsd: reservation.userCapUsd ?? undefined,
        resetAt: reservation.period.end,
        maxConcurrentStreams: limits.maxConcurrentStreams,
      }),
      lasting: LASTING_BLOCKS.has(reservation.reason),
      allowance: await allowance(),
    });
    return;
  }

  // From here on the reservation must be settled, whatever happens.
  const started = Date.now();
  let conversationId = input.conversationId;
  let settled = false;
  const settleWith = async (opts: {
    status: "OK" | "ERROR" | "ABORTED";
    usage: ApiUsageWithIterations | null;
    billedModel: string;
    errorCode?: string;
  }) => {
    settled = true;
    return settle(db, {
      reservationId: reservation.reservationId,
      conversationId,
      requestedModel: input.model,
      model: opts.billedModel,
      usage: opts.usage,
      status: opts.status,
      errorCode: opts.errorCode ?? null,
      durationMs: Date.now() - started,
    });
  };

  try {
    if (!claude) {
      await settleWith({
        status: "ERROR",
        usage: null,
        billedModel: input.model,
        errorCode: "api_key_missing",
      });
      return fail(friendlyError("missing_key"));
    }

    if (!conversationId) {
      const title = titleFromText(input.text);
      const created = await db.conversation.create({
        data: { userId: input.userId, title, model: input.model },
        select: { id: true },
      });
      conversationId = created.id;
      emit({ type: "conversation", id: created.id, title });
    }
    await db.message.create({
      data: { conversationId, role: "USER", content: input.content as object },
    });

    let result;
    try {
      result = await claude.stream(
        {
          model: input.model,
          maxTokens: reservation.maxTokens,
          effort: modelConfig.effort,
          system,
          messages,
          tools,
          compactAtTokens: modelConfig.compactAtTokens,
          userId: input.userId,
          signal: input.signal,
        },
        (e) => emit(e),
      );
    } catch (err) {
      const e =
        err instanceof ClaudeStreamError
          ? err
          : new ClaudeStreamError("unknown", "unknown_error", null, []);
      // Keep any text that arrived before the reply stopped, so the user doesn't lose it.
      const partial = textBlocksOnly(e.partialContent);
      const s = await settleWith({
        status: e.kind === "aborted" ? "ABORTED" : "ERROR",
        usage: e.partialUsage,
        billedModel: e.billedModel ?? input.model,
        errorCode: e.code,
      });
      if (partial.length > 0) {
        await db.message.create({
          data: {
            conversationId,
            role: "ASSISTANT",
            content: partial as object[],
            usageEventId: s.usageEventId,
          },
        });
      }
      await db.conversation.update({ where: { id: conversationId }, data: { model: input.model } });
      if (e.kind !== "aborted") console.error(`[chat] Claude call failed: ${e.code}`);
      return fail(friendlyError(e.kind));
    }

    // A refused reply may be partial; keep only its finished text.
    const content: BetaContentBlock[] =
      result.stopReason === "refusal" ? textBlocksOnly(result.content) : result.content;
    const s = await settleWith({ status: "OK", usage: result.usage, billedModel: result.model });
    if (s.unknownModel) console.error(`[chat] no price configured for model ${result.model}`);

    const message = await db.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: content as object[],
        usageEventId: s.usageEventId,
      },
      select: { id: true },
    });
    await db.conversation.update({ where: { id: conversationId }, data: { model: input.model } });

    const event = await db.usageEvent.findUniqueOrThrow({
      where: { id: s.usageEventId },
      select: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true,
      },
    });
    emit({
      type: "done",
      messageId: message.id,
      usage: {
        inputTokens: event.inputTokens + event.cacheCreationTokens + event.cacheReadTokens,
        outputTokens: event.outputTokens,
        cost: formatCostShort(s.costUsd),
      },
      notice: stopNotice(result.stopReason, reservation.maxTokens < modelConfig.maxTokens),
      allowance: await allowance(),
    });
  } finally {
    if (!settled) {
      // Something unexpected failed before settlement (e.g. a database error). Record it so the
      // reservation doesn't linger; if even this fails, the reservation expires in 10 minutes.
      await settleWith({
        status: "ERROR",
        usage: null,
        billedModel: input.model,
        errorCode: "internal_error",
      }).catch(() => console.error("[chat] could not settle reservation"));
    }
  }
}
