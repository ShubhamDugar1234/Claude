"use client";

/** Calls an admin API route. Returns the plain-words error message on failure. */
export async function adminSend<T = unknown>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string; data?: T }> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      return { ok: false, error: data.error ?? "Something went wrong. Please try again.", data };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Please try again." };
  }
}

export const input =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-base outline-none focus:border-brand sm:text-sm";
export const primaryButton =
  "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
export const secondaryButton =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50";
