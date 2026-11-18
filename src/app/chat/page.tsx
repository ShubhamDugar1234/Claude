import { requireUser } from "@/lib/session";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "Chat · MV Dugar AI Portal" };

// Placeholder for M2. The real chat (sidebar, streaming, allowance meter) arrives in M3.
export default async function ChatPage() {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <Brand size="sm" />
        <SignOutButton />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <h1 className="text-lg font-semibold">Signed in as {user.name}</h1>
        <p className="text-sm text-neutral-600">
          {user.email} · {user.businessName}
        </p>
        {user.status === "PAUSED" && (
          <p className="text-sm text-red-700">An administrator has paused your access to Claude.</p>
        )}
        <p className="mt-4 text-sm text-neutral-500">The chat arrives in the next milestone.</p>
      </main>
    </div>
  );
}
