"use client";
// Shown when a page fails unexpectedly. Never shows technical details to the user.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-neutral-600">
        Please try again. If it keeps happening, tell the ED&apos;s office.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </main>
  );
}
