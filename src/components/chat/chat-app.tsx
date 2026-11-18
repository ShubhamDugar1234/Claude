"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChatStreamEvent } from "@/lib/chat/service";

// Mirrors the server limits in lib/attachments (which can't be imported into the browser).
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
import { Brand } from "@/components/brand";
import { AllowanceMeter } from "./allowance-meter";
import { Composer } from "./composer";
import { MenuIcon } from "./icons";
import { MessageList } from "./message-list";
import { Sidebar } from "./sidebar";
import type { Allowance, ChatMessage, ConversationSummary, ModelOption } from "./types";

interface Props {
  user: { name: string; businessName: string | null };
  initialConversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: ChatMessage[];
  initialAllowance: Allowance | null;
  models: ModelOption[];
  defaultModel: string;
  signOut: React.ReactNode;
}

const MODEL_KEY = "portal.model";
const noopSubscribe = () => () => {};
function readSavedModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

/** Reads `data: {...}` events from the chat response stream. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6)) as ChatStreamEvent;
    }
  }
}

export function ChatApp(props: Props) {
  const [conversations, setConversations] = useState(props.initialConversations);
  const [activeId, setActiveId] = useState(props.initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(props.initialMessages);
  const [allowance, setAllowance] = useState(props.initialAllowance);
  // The chosen model is remembered on this device (a convenience only).
  const savedModel = useSyncExternalStore(noopSubscribe, readSavedModel, () => null);
  const [chosenModel, setModel] = useState<string | null>(null);
  const model =
    chosenModel ??
    (savedModel && props.models.some((m) => m.id === savedModel) ? savedModel : props.defaultModel);
  const router = useRouter();
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const blocked = allowance?.block ?? null;

  // Keep the newest text in view while a reply streams, unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Search chats by title (debounced).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversations?q=${encodeURIComponent(query)}`);
        if (r.ok) setConversations((await r.json()).conversations);
      } catch {
        /* keep the current list */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }, []);

  function addFiles(added: File[]) {
    const ok = /\.(pdf|png|jpe?g|gif|webp|xlsx|csv)$/i;
    const bad = added.find((f) => !ok.test(f.name));
    if (bad)
      return showToast(
        `"${bad.name}" isn't supported. Attach PDFs, images, Excel (.xlsx) or CSV files.`,
      );
    const big = added.find((f) => f.size > MAX_FILE_BYTES);
    if (big) return showToast(`"${big.name}" is larger than 20 MB.`);
    if (files.length + added.length > MAX_FILES) {
      showToast(`You can attach up to ${MAX_FILES} files per message.`);
    }
    setFiles((current) => [...current, ...added].slice(0, MAX_FILES));
  }

  const updateAssistant = (id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));

  async function openConversation(id: string) {
    if (streaming) return;
    setSidebarOpen(false);
    const r = await fetch(`/api/conversations/${id}`);
    if (!r.ok) {
      showToast("That chat couldn't be opened.");
      return;
    }
    const data = await r.json();
    setActiveId(id);
    setMessages(data.messages);
    stickToBottom.current = true;
    window.history.replaceState(null, "", `/chat/${id}`);
  }

  function newChat() {
    if (streaming) return;
    setActiveId(null);
    setMessages([]);
    setSidebarOpen(false);
    window.history.replaceState(null, "", "/chat");
  }

  async function rename(id: string, title: string) {
    const r = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (r.ok) setConversations((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
    else showToast("Couldn't rename that chat.");
  }

  async function remove(id: string) {
    const r = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!r.ok) return showToast("Couldn't delete that chat.");
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) newChat();
  }

  async function send() {
    const text = input.trim();
    const sending = files;
    if ((!text && sending.length === 0) || streaming || blocked) return;
    const userMsg: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      text,
      usage: null,
      attachments: sending.map((f) => ({ name: f.name, kind: "", converted: false })),
    };
    const pendingId = `local-reply-${Date.now()}`;
    const pending: ChatMessage = {
      id: pendingId,
      role: "assistant",
      text: "",
      usage: null,
      streaming: true,
    };
    setMessages((ms) => [...ms, userMsg, pending]);
    setInput("");
    setFiles([]);
    setStreaming(true);
    stickToBottom.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let replyId = pendingId;
    let conversationId = activeId;

    try {
      const form = new FormData();
      if (conversationId) form.set("conversationId", conversationId);
      form.set("model", model);
      form.set("message", text);
      for (const f of sending) form.append("files", f);
      const r = await fetch("/api/chat", { method: "POST", body: form, signal: controller.signal });
      if (!r.ok || !r.body) {
        const err = await r
          .json()
          .catch(() => ({ error: "Something went wrong. Please try again." }));
        if (r.status === 400 && sending.length > 0) {
          // A file was refused: give the message and files back so the user can fix it.
          setMessages((ms) => ms.filter((m) => m.id !== userMsg.id && m.id !== replyId));
          setInput(text);
          setFiles(sending);
          showToast(err.error);
          return;
        }
        updateAssistant(replyId, () => ({ streaming: false, error: err.error }));
        if (r.status === 401) router.push("/signin");
        return;
      }
      for await (const event of readEvents(r.body)) {
        switch (event.type) {
          case "conversation":
            conversationId = event.id;
            setActiveId(event.id);
            setConversations((cs) => [
              { id: event.id, title: event.title, updatedAt: new Date().toISOString() },
              ...cs,
            ]);
            window.history.replaceState(null, "", `/chat/${event.id}`);
            break;
          case "converted":
            setMessages((ms) =>
              ms.map((m) =>
                m.id === userMsg.id
                  ? {
                      ...m,
                      attachments: m.attachments?.map((a) => ({
                        ...a,
                        converted: a.converted || event.names.includes(a.name),
                      })),
                    }
                  : m,
              ),
            );
            break;
          case "text":
            updateAssistant(replyId, (m) => ({ text: m.text + event.text, status: null }));
            break;
          case "status":
            updateAssistant(replyId, () => ({ status: "Searching the web…" }));
            break;
          case "done": {
            const doneId = event.messageId;
            updateAssistant(replyId, () => ({
              id: doneId,
              streaming: false,
              status: null,
              usage: event.usage,
              notice: event.notice,
            }));
            replyId = doneId;
            if (event.allowance) setAllowance(event.allowance);
            break;
          }
          case "blocked":
            // Nothing was sent to Claude: put the message back in the box.
            setMessages((ms) => ms.filter((m) => m.id !== userMsg.id && m.id !== replyId));
            setInput(text);
            setFiles(sending);
            if (event.allowance) setAllowance(event.allowance);
            if (!event.lasting) showToast(event.message);
            else if (!event.allowance?.block) showToast(event.message);
            break;
          case "error":
            updateAssistant(replyId, () => ({
              streaming: false,
              status: null,
              error: event.message,
            }));
            if (event.allowance) setAllowance(event.allowance);
            break;
        }
      }
      if (conversationId) {
        const id = conversationId;
        setConversations((cs) => {
          const c = cs.find((x) => x.id === id);
          return c
            ? [{ ...c, updatedAt: new Date().toISOString() }, ...cs.filter((x) => x.id !== id)]
            : cs;
        });
      }
    } catch {
      if (controller.signal.aborted) {
        updateAssistant(replyId, () => ({ streaming: false, status: null, notice: "Stopped." }));
        // The server records the partial reply's cost; refresh the meter shortly after.
        setTimeout(async () => {
          const r = await fetch("/api/me/allowance").catch(() => null);
          if (r?.ok) setAllowance(await r.json());
        }, 1500);
      } else {
        updateAssistant(replyId, () => ({
          streaming: false,
          status: null,
          error: "The connection was lost. Please try again.",
        }));
      }
    } finally {
      setMessages((ms) =>
        ms.map((m) => (m.id === replyId && m.streaming ? { ...m, streaming: false } : m)),
      );
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeId={activeId}
      query={query}
      onQuery={setQuery}
      onSelect={openConversation}
      onNew={newChat}
      onRename={rename}
      onDelete={remove}
      onClose={() => setSidebarOpen(false)}
      footer={
        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{props.user.name}</p>
            <p className="truncate text-xs text-neutral-500">{props.user.businessName}</p>
          </div>
          {props.signOut}
        </div>
      }
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-neutral-200 md:block">{sidebar}</aside>
      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[85%] max-w-xs shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div
        className={`relative flex min-w-0 flex-1 flex-col ${dragging ? "bg-brand/5" : ""}`}
        onDragOver={(e) => {
          if (blocked || streaming || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!blocked && !streaming) addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-neutral-700 md:hidden"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <AllowanceMeter allowance={allowance} />
          <label className="shrink-0">
            <span className="sr-only">Model</span>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                try {
                  localStorage.setItem(MODEL_KEY, e.target.value);
                } catch {
                  /* storage unavailable */
                }
              }}
              disabled={streaming}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-base sm:text-sm"
              aria-label="Model"
            >
              {props.models.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Brand />
              <p className="max-w-sm text-sm text-neutral-500">
                Ask anything: draft a letter, summarise a report, check figures, translate. Your
                chats are private.
              </p>
            </div>
          ) : (
            <MessageList messages={messages} />
          )}
        </div>

        {blocked && (
          <div role="alert" className="mx-auto mb-2 w-full max-w-3xl px-4">
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {blocked.message}
            </p>
          </div>
        )}
        {toast && (
          <div className="mx-auto mb-2 w-full max-w-3xl px-4">
            <p role="status" className="rounded-lg bg-neutral-800 px-4 py-2.5 text-sm text-white">
              {toast}
            </p>
          </div>
        )}
        <Composer
          value={input}
          onChange={setInput}
          files={files}
          onAddFiles={addFiles}
          onRemoveFile={(i) => setFiles((fs) => fs.filter((_, j) => j !== i))}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          streaming={streaming}
          disabled={!!blocked}
          placeholder={blocked ? "Chat is unavailable" : "Message Claude"}
        />
      </div>
    </div>
  );
}
