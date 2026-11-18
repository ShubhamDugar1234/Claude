import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { acceptNotice } from "./actions";

export const metadata = { title: "Before you start · MV Dugar AI Portal" };

export default async function WelcomePage() {
  const user = await requireUser({ allowNoNotice: true });
  if (user.noticeAcceptedAt) redirect("/chat");

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Before you start, {user.name.split(" ")[0]}</h1>
      <div className="space-y-3 text-sm text-neutral-700">
        <p>
          <strong>What this is for.</strong> Use Claude to help with your work at MV Dugar Group:
          drafting emails and letters, summarising documents, working with numbers, translating, and
          answering questions.
        </p>
        <p>
          <strong>Your chats are private.</strong> Nobody else, including administrators, can read
          your conversations. The company does track how much each person uses (number of requests,
          size and cost), but never what you wrote.
        </p>
        <p>
          <strong>Never paste:</strong>
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>customers&apos; personal details (citizenship numbers, phone numbers, addresses)</li>
          <li>loan account numbers or other account details</li>
          <li>passwords, PINs or one-time codes</li>
        </ul>
        <p>
          <strong>Check its answers.</strong> Claude can make mistakes. Check important facts and
          figures before you use them.
        </p>
      </div>
      <form action={acceptNotice}>
        <button
          type="submit"
          className="w-full rounded-lg bg-brand px-4 py-3 text-base font-medium text-white"
        >
          I understand, let&apos;s start
        </button>
      </form>
    </div>
  );
}
