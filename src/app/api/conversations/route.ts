import { db } from "@/lib/db";
import { apiUser } from "@/lib/api";
import { listConversations } from "@/lib/chat/conversations";

export async function GET(request: Request) {
  const auth = await apiUser(request);
  if ("response" in auth) return auth.response;
  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  const conversations = await listConversations(db, auth.user.id, q);
  return Response.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
}
