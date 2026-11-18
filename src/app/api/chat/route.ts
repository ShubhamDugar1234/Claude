import { db } from "@/lib/db";
import { apiUser, jsonError } from "@/lib/api";
import { getClaudeClient } from "@/lib/claude";
import { MAX_MESSAGE_CHARS, runChatTurn, type ChatStreamEvent } from "@/lib/chat/service";

// Long replies can take a few minutes.
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await apiUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  let body: { conversationId?: unknown; model?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request.");
  }
  const text = typeof body.message === "string" ? body.message.trim() : "";
  if (!text) return jsonError(400, "Please type a message.");
  if (text.length > MAX_MESSAGE_CHARS) {
    return jsonError(
      400,
      `Messages can be at most ${MAX_MESSAGE_CHARS.toLocaleString("en")} characters.`,
    );
  }
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
  const model = typeof body.model === "string" ? body.model : "";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false; // the browser went away; the turn still finishes and settles
        }
      };
      try {
        await runChatTurn(
          { db, claudeFor: getClaudeClient },
          {
            userId: auth.user.id,
            conversationId,
            model,
            content: [{ type: "text", text }],
            text,
            signal: request.signal,
          },
          emit,
        );
      } catch {
        console.error("[chat] unexpected failure in chat turn");
        emit({
          type: "error",
          message: "Something went wrong. Please try again.",
          allowance: null,
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
