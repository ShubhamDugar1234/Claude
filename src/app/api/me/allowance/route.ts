import { db } from "@/lib/db";
import { apiUser } from "@/lib/api";
import { getAllowance } from "@/lib/limits/allowance";

export async function GET(request: Request) {
  const auth = await apiUser(request);
  if ("response" in auth) return auth.response;
  return Response.json(await getAllowance(db, auth.user.id), {
    headers: { "Cache-Control": "no-store" },
  });
}
