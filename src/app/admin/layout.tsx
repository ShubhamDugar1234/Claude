import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { isSuper } from "@/lib/admin/scope";
import { Brand } from "@/components/brand";
import { AdminNav } from "@/components/admin/nav";

export const metadata = { title: "Admin · MV Dugar AI Portal" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user, scope } = await requireAdminPage();
  return (
    <div className="flex min-h-dvh flex-col bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3">
          <Brand size="sm" />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-500 sm:inline">
              {isSuper(scope) ? "Super admin" : `Admin · ${user.businessName}`}
            </span>
            <Link href="/chat" className="text-brand underline-offset-2 hover:underline">
              Back to chat
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pt-2">
          <AdminNav isSuper={isSuper(scope)} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
