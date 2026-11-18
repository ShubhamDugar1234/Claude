// Conversation and message access. Every function takes the owner's userId and only ever
// touches that user's rows. There is deliberately no function that reads messages without it.
import type { PrismaClient } from "@/generated/prisma/client";
import type {
  BetaAssistantMessageParam,
  BetaUserMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaContentBlock, BetaMessageParam, ClaudeClient } from "@/lib/claude/types";
import { fileIdsInContent } from "@/lib/attachments";
import { formatCostShort, money } from "@/lib/money";

type Db = PrismaClient;

export const MAX_TITLE_LENGTH = 60;

/** Title from the first message: first line, tidied, at most 60 characters. */
export function titleFromText(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > MAX_TITLE_LENGTH
    ? `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : clean;
}

export function cleanTitle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  return t || null;
}

type StoredBlock = { type: string; text?: string };

/** The visible text of a stored message. */
export function messageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as StoredBlock[])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/** Keeps only finished text from a reply that was cut short (thinking and tool blocks may be incomplete). */
export function textBlocksOnly(content: BetaContentBlock[]): BetaContentBlock[] {
  return content.filter((b) => b.type === "text" && b.text.length > 0);
}

/** Stored messages, oldest first, in the shape the API expects. */
export function toApiMessages(
  rows: { role: "USER" | "ASSISTANT"; content: unknown }[],
): BetaMessageParam[] {
  return rows
    .filter((r) => Array.isArray(r.content) && (r.content as unknown[]).length > 0)
    .map((r): BetaMessageParam =>
      r.role === "USER"
        ? { role: "user", content: r.content as BetaUserMessageParam["content"] }
        : { role: "assistant", content: r.content as BetaAssistantMessageParam["content"] },
    );
}

export async function listConversations(db: Db, userId: string, query?: string) {
  const q = query?.trim();
  return db.conversation.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, updatedAt: true },
  });
}

export async function findOwnConversation(db: Db, userId: string, id: string) {
  return db.conversation.findFirst({
    where: { id, userId, deletedAt: null },
    select: { id: true, title: true, model: true },
  });
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  usage: { inputTokens: number; outputTokens: number; cost: string } | null;
  attachments: { name: string; kind: string; converted: boolean }[];
}

function attachmentsFor(value: unknown): DisplayMessage["attachments"] {
  if (!Array.isArray(value)) return [];
  return (value as { name?: unknown; kind?: unknown; converted?: unknown }[])
    .filter((a) => typeof a?.name === "string")
    .map((a) => ({
      name: String(a.name),
      kind: String(a.kind ?? ""),
      converted: a.converted === true,
    }));
}

/** Messages for the chat screen, with the usage line for each reply. Owner only. */
export async function getConversationForDisplay(db: Db, userId: string, id: string) {
  const conversation = await findOwnConversation(db, userId, id);
  if (!conversation) return null;
  const rows = await db.message.findMany({
    where: { conversationId: id, conversation: { userId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, attachments: true, usageEventId: true },
  });
  const eventIds = rows.map((r) => r.usageEventId).filter((x): x is string => !!x);
  const events = await db.usageEvent.findMany({
    where: { id: { in: eventIds }, userId },
    select: {
      id: true,
      inputTokens: true,
      outputTokens: true,
      cacheCreationTokens: true,
      cacheReadTokens: true,
      costUsd: true,
    },
  });
  const byId = new Map(events.map((e) => [e.id, e]));
  const messages: DisplayMessage[] = rows.map((r) => {
    const e = r.usageEventId ? byId.get(r.usageEventId) : undefined;
    return {
      id: r.id,
      role: r.role === "USER" ? "user" : "assistant",
      text: messageText(r.content),
      attachments: attachmentsFor(r.attachments),
      usage: e
        ? {
            inputTokens: e.inputTokens + e.cacheCreationTokens + e.cacheReadTokens,
            outputTokens: e.outputTokens,
            cost: formatCostShort(money(e.costUsd)),
          }
        : null,
    };
  });
  return { conversation, messages };
}

export async function renameConversation(db: Db, userId: string, id: string, title: string) {
  const r = await db.conversation.updateMany({
    where: { id, userId, deletedAt: null },
    data: { title },
  });
  return r.count === 1;
}

/**
 * Deletes a conversation's content: messages are removed and the title cleared. The row stays
 * (soft-deleted) so usage records keep their link for billing. Returns the Anthropic file ids
 * the conversation used (so the caller can delete them there too), or null if not found.
 */
export async function deleteConversation(
  db: Db,
  userId: string,
  id: string,
): Promise<string[] | null> {
  return db.$transaction(async (tx) => {
    const own = await tx.conversation.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });
    if (!own) return null;
    const rows = await tx.message.findMany({
      where: { conversationId: id },
      select: { content: true },
    });
    await tx.message.deleteMany({ where: { conversationId: id } });
    await tx.conversation.update({ where: { id }, data: { deletedAt: new Date(), title: "" } });
    return rows.flatMap((r) => fileIdsInContent(r.content));
  });
}

/** Best effort: removes uploaded files from Anthropic. Failures are logged, never shown. */
export async function deleteUploadedFiles(
  client: ClaudeClient | null,
  fileIds: string[],
): Promise<void> {
  if (!client || fileIds.length === 0) return;
  const results = await Promise.allSettled(fileIds.map((id) => client.deleteFile(id)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.error(`[files] could not delete ${failed} uploaded file(s)`);
}
