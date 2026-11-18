import { db } from "@/lib/db";
import { apiUser, jsonError } from "@/lib/api";
import { getClaudeClient } from "@/lib/claude";
import { MAX_MESSAGE_CHARS, runChatTurn, type ChatStreamEvent } from "@/lib/chat/service";
import {
  AttachmentError,
  MAX_FILE_BYTES,
  MAX_FILES,
  prepareAttachments,
  type PreparedAttachment,
} from "@/lib/attachments";

// Long replies can take a few minutes.
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await apiUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // A message is sent as a form: text fields plus up to 5 files.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_FILES * MAX_FILE_BYTES + 2 * 1024 * 1024) {
    return jsonError(413, "These files are too large. Each file can be up to 20 MB.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Invalid request.");
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const text = field("message").trim();
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (!text && files.length === 0) return jsonError(400, "Please type a message.");
  if (text.length > MAX_MESSAGE_CHARS) {
    return jsonError(
      400,
      `Messages can be at most ${MAX_MESSAGE_CHARS.toLocaleString("en")} characters.`,
    );
  }
  if (files.length > MAX_FILES)
    return jsonError(400, `You can attach up to ${MAX_FILES} files per message.`);
  if (files.some((f) => f.size > MAX_FILE_BYTES))
    return jsonError(400, "Each file can be up to 20 MB.");

  let attachments: PreparedAttachment[];
  try {
    attachments = await prepareAttachments(
      await Promise.all(
        files.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })),
      ),
    );
  } catch (e) {
    if (e instanceof AttachmentError) return jsonError(400, e.userMessage);
    console.error("[chat] could not read attachments");
    return jsonError(400, "Your files couldn't be read. Please try again.");
  }
  const conversationId = field("conversationId") || null;
  const model = field("model");

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
            text,
            attachments,
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
