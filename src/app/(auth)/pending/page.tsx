import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata = { title: "Waiting for approval · MV Dugar AI Portal" };

export default async function PendingPage() {
  const user = await requireUser({ allowPending: true, allowNoNotice: true });
  if (user.status !== "PENDING" && user.businessId) redirect("/chat");

  return (
    <div className="space-y-4 text-center">
      <h1 className="text-lg font-semibold">Waiting for approval</h1>
      <p className="text-sm text-neutral-600">
        Thanks, {user.name}. You&apos;re signed in as {user.email}, but an administrator still needs
        to add you to your business before you can use Claude.
      </p>
      <p className="text-sm text-neutral-600">
        Ask your manager or the ED&apos;s office to approve you, then come back to this page.
      </p>
      <SignOutButton />
    </div>
  );
}
