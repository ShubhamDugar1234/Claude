import { db } from "@/lib/db";
import { adminApi, adminErrorResponse } from "@/lib/admin/guard";
import { updateUser } from "@/lib/admin/users";

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  const a = await adminApi(request, { mutating: true });
  if ("response" in a) return a.response;
  try {
    const { id } = await ctx.params;
    return Response.json(await updateUser(db, a.scope, id, await request.json()));
  } catch (e) {
    return adminErrorResponse(e);
  }
}
