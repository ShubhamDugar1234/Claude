// Runs the daily job. Called once a day by the scheduler (the cron container in docker-compose,
// or Vercel Cron) with the header "Authorization: Bearer <CRON_SECRET>".
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getClaudeClient } from "@/lib/claude";
import { runDailyJobs } from "@/lib/jobs/daily";

export const maxDuration = 300;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = request.headers.get("authorization") ?? "";
  // Compare hashes so the check takes the same time whatever was sent.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16) {
    return jsonError(503, "CRON_SECRET is not set (it must be at least 16 characters).");
  }
  if (!authorised(request)) return jsonError(401, "Not allowed.");
  const result = await runDailyJobs(db, getClaudeClient);
  console.info("[jobs] daily job finished", JSON.stringify(result));
  return Response.json(result);
}

export const GET = run;
export const POST = run;
