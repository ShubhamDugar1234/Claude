import { db } from "@/lib/db";
import { adminApi } from "@/lib/admin/guard";
import { getOverview } from "@/lib/admin/overview";

export async function GET(request: Request) {
  const a = await adminApi(request);
  if ("response" in a) return a.response;
  return Response.json(await getOverview(db, a.scope), {
    headers: { "Cache-Control": "no-store" },
  });
}
