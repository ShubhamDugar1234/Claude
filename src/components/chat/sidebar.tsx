"use client";
import { useState } from "react";
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";
import type { ConversationSummary } from "./types";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  footer: React.ReactNode;
}

export function Sidebar(p: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="flex h-full flex-col bg-neutral-50">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={p.onNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-medium text-white"
        >
          <PlusIcon /> New chat
        </button>
        <button
          type="button"
          onClick={p.onClose}
          className="rounded-lg p-2 text-neutral-600 md:hidden"
          aria-label="Close menu"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="px-3 pb-2">
        <input
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
        />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Your chats">
        {p.conversations.length === 0 && (
          <p className="px-2 py-4 text-sm text-neutral-500">
            {p.query ? "No chats match your search." : "No chats yet."}
          </p>
        )}
        <ul className="space-y-0.5">
          {p.conversations.map((c) => (
            <li key={c.id}>
              {editing === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) p.onRename(c.id, draft.trim());
                    setEditing(null);
                  }}
                  className="px-1"
                >
                  <input
                    autoFocus
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    aria-label="Chat name"
                    className="w-full rounded-md border border-brand bg-white px-2 py-1.5 text-base sm:text-sm"
                  />
                </form>
              ) : (
                <div
                  className={`group flex items-center rounded-md ${c.id === p.activeId ? "bg-neutral-200" : "hover:bg-neutral-100"}`}
                >
                  <button
                    type="button"
                    onClick={() => p.onSelect(c.id)}
                    className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
                    aria-current={c.id === p.activeId ? "page" : undefined}
                  >
                    {c.title}
                  </button>
                  <div
                    className={`flex shrink-0 pr-1 ${c.id === p.activeId ? "" : "md:hidden md:group-hover:flex"}`}
                  >
                    <button
                      type="button"
                      aria-label={`Rename "${c.title}"`}
                      onClick={() => {
                        setDraft(c.title);
                        setEditing(c.id);
                      }}
                      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete "${c.title}"`}
                      onClick={() => {
                        if (window.confirm(`Delete "${c.title}"? This can't be undone.`))
                          p.onDelete(c.id);
                      }}
                      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-red-700"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-neutral-200 p-3">{p.footer}</div>
    </div>
  );
}
