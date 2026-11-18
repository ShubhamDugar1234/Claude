import { db } from "@/lib/db";
import { adminApi } from "@/lib/admin/guard";
import { exportCsv } from "@/lib/admin/overview";

export async function GET(request: Request) {
  const a = await adminApi(request);
  if ("response" in a) return a.response;
  const kind =
    new URL(request.url).searchParams.get("kind") === "businesses" ? "businesses" : "people";
  const csv = await exportCsv(db, a.scope, kind);
  const month = new Date().toISOString().slice(0, 7);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="usage-by-${kind === "people" ? "person" : "business"}-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
