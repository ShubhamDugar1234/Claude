import { inject } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { Limits } from "@/config/limits";

export function makeDb() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: inject("databaseUrl"), max: 20 }),
  });
}

export type TestDb = ReturnType<typeof makeDb>;

export async function resetDb(db: TestDb) {
  await db.$executeRawUnsafe(
    `TRUNCATE "AuditLog", "Reservation", "UsageEvent", "Message", "Conversation", "Session", "Account", "VerificationToken", "Setting", "User", "Business" CASCADE`,
  );
}

let n = 0;

export async function createBusiness(
  db: TestDb,
  data: Partial<{ budget: string; allowedModels: string[]; active: boolean }> = {},
) {
  n += 1;
  return db.business.create({
    data: {
      name: `Business ${n}`,
      monthlyBudgetUsd: data.budget ?? "1000",
      allowedModels: data.allowedModels ?? ["claude-sonnet-5-5", "claude-haiku-5-5"],
      active: data.active ?? true,
    },
  });
}

export async function createUser(
  db: TestDb,
  businessId: string | null,
  data: Partial<{ cap: string; status: "ACTIVE" | "PAUSED" | "PENDING" | "DEACTIVATED" }> = {},
) {
  n += 1;
  return db.user.create({
    data: {
      name: `User ${n}`,
      email: `user${n}@mvdugar.com`,
      businessId,
      monthlyCapUsd: data.cap ?? "10",
      status: data.status ?? "ACTIVE",
    },
  });
}

/** Generous limits so tests of one rule aren't tripped by another. */
export const TEST_LIMITS: Limits = {
  defaultUserCapUsd: "10",
  billingResetDay: 1,
  rateLimitPerMinute: 1000,
  maxConcurrentStreams: 1000,
  reservationTtlMs: 10 * 60 * 1000,
  minOutputTokens: 2048,
  webSearchMaxUses: 3,
  webSearchInputAllowanceTokensPerSearch: 25_000,
  retentionDays: 180,
};
