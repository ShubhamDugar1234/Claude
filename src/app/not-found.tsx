import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Brand />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link href="/chat" className="text-brand underline-offset-2 hover:underline">
        Go to your chats
      </Link>
    </main>
  );
}
