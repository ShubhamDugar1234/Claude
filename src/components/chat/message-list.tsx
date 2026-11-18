"use client";
import { FileIcon } from "./icons";
import { Markdown } from "./markdown";
import type { ChatMessage } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <ol className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6" aria-live="polite">
      {messages.map((m) =>
        m.role === "user" ? (
          <li key={m.id} className="flex justify-end">
            <div className="flex max-w-[85%] flex-col items-end gap-1.5">
              {m.attachments && m.attachments.length > 0 && (
                <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Attached files">
                  {m.attachments.map((a, i) => (
                    <li
                      key={`${a.name}-${i}`}
                      className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700"
                    >
                      <FileIcon />
                      <span className="truncate">{a.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {m.text && (
                <div className="whitespace-pre-wrap break-words rounded-2xl bg-neutral-100 px-4 py-2.5 text-[15px]">
                  {m.text}
                </div>
              )}
              {m.attachments
                ?.filter((a) => a.converted)
                .map((a, i) => (
                  <p key={`c-${i}`} className="text-xs text-neutral-500">
                    {a.name} was converted to CSV text so Claude can read it.
                  </p>
                ))}
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
