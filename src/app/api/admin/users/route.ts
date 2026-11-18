import { db } from "@/lib/db";
import { adminApi, adminErrorResponse } from "@/lib/admin/guard";
import { createUser, listUsers } from "@/lib/admin/users";

export async function GET(request: Request) {
  const a = await adminApi(request);
  if ("response" in a) return a.response;
  return Response.json(
    { users: await listUsers(db, a.scope) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const a = await adminApi(request, { mutating: true });
  if ("response" in a) return a.response;
  try {
    const body = await request.json();
    const id = await createUser(db, a.scope, body);
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return adminErrorResponse(e);
  }
}
