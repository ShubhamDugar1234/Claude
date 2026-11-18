import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "STAFF" | "BUSINESS_ADMIN" | "SUPER_ADMIN";
  status: "ACTIVE" | "PAUSED" | "PENDING" | "DEACTIVATED";
  businessId: string | null;
  businessName: string | null;
  noticeAcceptedAt: Date | null;
}

/** The signed-in user, read fresh from the database on every call. Null if signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      businessId: true,
      noticeAcceptedAt: true,
      business: { select: { name: true } },
    },
  });
  if (!u || u.status === "DEACTIVATED") return null;
  return { ...u, businessName: u.business?.name ?? null };
}

/**
 * For pages that need a signed-in user. Sends people to the right place otherwise:
 * signed out -> /signin, waiting for approval -> /pending, notice not yet accepted -> /welcome.
 */
export async function requireUser(opts: { allowPending?: boolean; allowNoNotice?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!opts.allowPending && (user.status === "PENDING" || !user.businessId)) redirect("/pending");
  if (!opts.allowNoNotice && !user.noticeAcceptedAt) redirect("/welcome");
  return user;
}
