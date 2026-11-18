import "server-only";
import { redirect } from "next/navigation";
import { apiUser, jsonError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { AdminError, scopeFor, type AdminScope } from "@/lib/admin/scope";

/** For admin pages: the admin's scope, or a redirect to the chat for everyone else. */
export async function requireAdminPage() {
  const user = await requireUser();
  const scope = scopeFor(user);
  if (!scope) redirect("/chat");
  return { user, scope };
}

/** For admin API routes: the admin's scope, or an error response. */
export async function adminApi(
  request: Request,
  opts: { mutating?: boolean } = {},
): Promise<{ scope: AdminScope } | { response: Response }> {
  const auth = await apiUser(request, opts);
  if ("response" in auth) return auth;
  const scope = scopeFor(auth.user);
  if (!scope) return { response: jsonError(403, "Admins only.") };
  return { scope };
}

/** Turns a rule violation into a plain-words JSON error; anything else is a 500 without details. */
export function adminErrorResponse(e: unknown): Response {
  if (e instanceof AdminError) return jsonError(e.status, e.message);
  console.error("[admin] unexpected error");
  return jsonError(500, "Something went wrong. Please try again.");
}
