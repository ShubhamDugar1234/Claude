import { db } from "@/lib/db";
import { apiUser, jsonError } from "@/lib/api";
import {
  cleanTitle,
  deleteConversation,
  getConversationForDisplay,
  renameConversation,
} from "@/lib/chat/conversations";

// Every handler is scoped to the signed-in user: another user's id simply isn't found.

export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await apiUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const data = await getConversationForDisplay(db, auth.user.id, id);
  if (!data) return jsonError(404, "Conversation not found.");
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await apiUser(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const title = cleanTitle((body as { title?: unknown }).title);
  if (!title) return jsonError(400, "Please enter a name.");
  if (!(await renameConversation(db, auth.user.id, id, title)))
    return jsonError(404, "Conversation not found.");
  return Response.json({ id, title });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  const auth = await apiUser(request, { mutating: true });
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await deleteConversation(db, auth.user.id, id)))
    return jsonError(404, "Conversation not found.");
  return Response.json({ id, deleted: true });
}
