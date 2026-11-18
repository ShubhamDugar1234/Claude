// A fake Claude for development and tests (MOCK_ANTHROPIC=true). No network calls, no cost.
// Messages containing MOCK_ERROR fail part-way; MOCK_SLOW streams slowly (for testing Stop).
import { createHash } from "node:crypto";
import { ClaudeStreamError, type ClaudeClient, type ClaudeRequest } from "@/lib/claude/types";

function lastUserAttachments(req: Pick<ClaudeRequest, "messages">): string[] {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last || typeof last.content === "string") return [];
  return last.content.flatMap((b) =>
    b.type === "document" ? [b.title ?? "document"] : b.type === "image" ? ["image"] : [],
  );
}

function lastUserText(req: Pick<ClaudeRequest, "messages">): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join(" ")
    .trim();
}

function promptBytes(req: Pick<ClaudeRequest, "messages" | "system">): number {
  return Buffer.byteLength(JSON.stringify([req.system, req.messages]), "utf8");
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

export function createMockClaude(): ClaudeClient {
  return {
    async countTokens(req) {
      return Math.ceil(promptBytes(req) / 4);
    },

    async stream(req, onEvent) {
      const said = lastUserText(req).replace(/\s+/g, " ").slice(0, 80);
      const files = lastUserAttachments(req);
      const filesNote =
        files.length > 0
          ? `\n\nI received ${files.length} attachment(s): ${files.join(", ")}.`
          : "";
      const slow = said.includes("MOCK_SLOW");
      const reply = slow
        ? Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(" ")
        : `This is a **mock reply** from ${req.model}. You said: "${said}"\n\n` +
          "```js\nconsole.log('hello from the mock');\n```" +
          filesNote;
      const words = reply.split(/(?<= )/);
      const inputTokens = Math.ceil(promptBytes(req) / 4);
      let sent = "";
      const usageSoFar = () => ({
        input_tokens: inputTokens,
        output_tokens: Math.ceil(sent.length / 4),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: { web_search_requests: 0 },
        iterations: null,
      });

      for (const [i, word] of words.entries()) {
        if (said.includes("MOCK_ERROR") && i === 3) {
          throw new ClaudeStreamError("overloaded", "overloaded_error", usageSoFar(), [
            { type: "text", text: sent, citations: null },
          ]);
        }
        try {
          await sleep(slow ? 150 : 10, req.signal);
        } catch {
          throw new ClaudeStreamError("aborted", "aborted", usageSoFar(), [
            { type: "text", text: sent, citations: null },
          ]);
        }
        sent += word;
        onEvent({ type: "text", text: word });
      }

      return {
        content: [{ type: "text", text: sent, citations: null }],
        usage: usageSoFar(),
        model: req.model,
        stopReason: "end_turn",
      };
    },

    async uploadFile({ bytes }) {
      return `file_mock_${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
    },

    async deleteFile() {},
  };
}
