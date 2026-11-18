import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * A hash of the visitor's IP address, for rate limits. Behind Caddy (or Vercel) the proxy sets
 * X-Forwarded-For to the real client address. Only the hash is ever stored.
 */
export async function clientIpHash(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  if (!ip) return null;
  return createHash("sha256")
    .update(`${ip}\n${process.env.AUTH_SECRET ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}
