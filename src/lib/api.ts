import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/session";

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Blocks cross-site requests that change data. Session cookies are SameSite=Lax already;
 * this is a second check that the request came from our own pages.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from some browsers omit it; cookies are Lax anyway
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The signed-in user for an API route, or an error response. */
export async function apiUser(
  request: Request,
  opts: { mutating?: boolean } = {},
): Promise<{ user: CurrentUser } | { response: Response }> {
  if (opts.mutating && !sameOrigin(request))
    return { response: jsonError(403, "Cross-site request refused.") };
  const user = await getCurrentUser();
  if (!user) return { response: jsonError(401, "Please sign in again.") };
  if (!user.noticeAcceptedAt)
    return { response: jsonError(403, "Please accept the notice first.") };
  return { user };
}
