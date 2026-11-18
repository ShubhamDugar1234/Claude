"use client";
import { useEffect, useRef } from "react";
import { SendIcon, StopIcon } from "./icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
}

export function Composer(p: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

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
        if (!p.streaming) p.onSend();
      }}
      className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pb-4"
    >
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
            if (!p.streaming && !p.disabled) p.onSend();
          }
        }}
        placeholder={p.placeholder}
        aria-label="Message"
        className="max-h-[200px] min-h-[46px] flex-1 resize-none rounded-xl border border-neutral-300 px-3.5 py-3 text-base outline-none focus:border-brand disabled:bg-neutral-100 disabled:text-neutral-500"
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
          disabled={p.disabled || !p.value.trim()}
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon />
        </button>
      )}
    </form>
  );
}
