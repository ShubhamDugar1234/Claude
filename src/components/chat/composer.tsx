"use client";
import { useEffect, useRef } from "react";
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon, StopIcon } from "./icons";

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.csv";

interface Props {
  value: string;
  onChange: (v: string) => void;
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
}

function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Composer(p: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = !p.disabled && (p.value.trim().length > 0 || p.files.length > 0);

  // Grow with the text, up to about 8 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [p.value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!p.streaming && canSend) p.onSend();
      }}
      className="mx-auto w-full max-w-3xl px-4 pb-4"
    >
      {p.files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files to send">
          {p.files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex max-w-full items-center gap-1.5 rounded-lg border border-neutral-300 bg-white py-1 pl-2 pr-1 text-xs"
            >
              <FileIcon />
              <span className="max-w-[12rem] truncate">{f.name}</span>
              <span className="text-neutral-400">{size(f.size)}</span>
              <button
                type="button"
                onClick={() => p.onRemoveFile(i)}
                disabled={p.streaming}
                className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100"
                aria-label={`Remove ${f.name}`}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          aria-label="Attach files"
          onChange={(e) => {
            p.onAddFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={p.disabled || p.streaming}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-neutral-300 text-neutral-600 disabled:opacity-40"
          aria-label="Attach files"
          title="Attach PDFs, images, Excel or CSV files"
        >
          <PaperclipIcon />
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={p.value}
          disabled={p.disabled}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on keyboards with a Shift key; on phones Enter adds a new line.
            const touch = window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!p.streaming && canSend) p.onSend();
            }
          }}
          placeholder={p.placeholder}
          aria-label="Message"
          className="max-h-[200px] min-h-[46px] min-w-0 flex-1 resize-none rounded-xl border border-neutral-300 px-3.5 py-3 text-base outline-none focus:border-brand disabled:bg-neutral-100 disabled:text-neutral-500"
        />
        {p.streaming ? (
          <button
            type="button"
            onClick={p.onStop}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-white"
            aria-label="Stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
            aria-label="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </form>
  );
}
