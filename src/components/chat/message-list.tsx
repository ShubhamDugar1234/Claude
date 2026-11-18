"use client";
import { Markdown } from "./markdown";
import type { ChatMessage } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <ol className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6" aria-live="polite">
      {messages.map((m) =>
        m.role === "user" ? (
          <li key={m.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px]">
              {m.text}
            </div>
          </li>
        ) : (
          <li key={m.id} className="text-[15px]">
            {m.text ? (
              <Markdown text={m.text} />
            ) : m.streaming ? (
              <p className="animate-pulse text-sm text-neutral-500">{m.status ?? "Thinking…"}</p>
            ) : null}
            {m.streaming && m.text && m.status && (
              <p className="mt-2 text-sm text-neutral-500">{m.status}</p>
            )}
            {m.notice && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {m.notice}
              </p>
            )}
            {m.error && (
              <p role="status" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {m.error}
              </p>
            )}
            {m.usage && (
              <p className="mt-1.5 text-xs text-neutral-400" data-testid="usage-line">
                {fmt(m.usage.inputTokens)} in · {fmt(m.usage.outputTokens)} out · {m.usage.cost}
              </p>
            )}
          </li>
        ),
      )}
    </ol>
  );
}
