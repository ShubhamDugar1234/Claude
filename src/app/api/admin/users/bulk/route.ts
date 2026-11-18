import { db } from "@/lib/db";
import { adminApi, adminErrorResponse } from "@/lib/admin/guard";
import { bulkCreateUsers } from "@/lib/admin/users";

export async function POST(request: Request) {
  const a = await adminApi(request, { mutating: true });
  if ("response" in a) return a.response;
  try {
    const { csv } = (await request.json()) as { csv?: unknown };
    const result = await bulkCreateUsers(db, a.scope, typeof csv === "string" ? csv : "");
    return Response.json(result, { status: result.errors.length > 0 ? 400 : 201 });
  } catch (e) {
    return adminErrorResponse(e);
  }
}
