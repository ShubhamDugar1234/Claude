import { db } from "@/lib/db";
import { adminApi, adminErrorResponse } from "@/lib/admin/guard";
import { createBusiness, listBusinesses } from "@/lib/admin/businesses";

export async function GET(request: Request) {
  const a = await adminApi(request);
  if ("response" in a) return a.response;
  return Response.json(
    { businesses: await listBusinesses(db, a.scope) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const a = await adminApi(request, { mutating: true });
  if ("response" in a) return a.response;
  try {
    return Response.json(await createBusiness(db, a.scope, await request.json()), { status: 201 });
  } catch (e) {
    return adminErrorResponse(e);
  }
}
