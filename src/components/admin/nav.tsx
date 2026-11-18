"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ isSuper }: { isSuper: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: "/admin", label: "Usage & limits" },
    { href: "/admin/users", label: "Users" },
    ...(isSuper ? [{ href: "/admin/businesses", label: "Businesses" }] : []),
    { href: "/admin/audit", label: "Audit log" },
  ];
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Admin sections">
      {tabs.map((t) => {
        const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              active
                ? "border-brand font-medium text-brand"
                : "border-transparent text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
