import { db } from "@/lib/db";
import { adminApi } from "@/lib/admin/guard";
import { listAudit } from "@/lib/admin/audit";

export async function GET(request: Request) {
  const a = await adminApi(request);
  if ("response" in a) return a.response;
  return Response.json(
    { entries: await listAudit(db, a.scope) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
