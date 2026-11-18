// Production-safe seed: creates the businesses and the super admin if they don't exist.
// Re-running it never overwrites budgets, models or caps an admin has changed.
// Run with: npm run db:seed
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";
const OPUS = "claude-opus-5-5";

export const BUSINESSES: { name: string; budget: string; models: string[] }[] = [
  { name: "Group / ED Office", budget: "100", models: [SONNET, HAIKU, OPUS] },
  { name: "Mahindra", budget: "50", models: [SONNET, HAIKU] },
  { name: "Tata Hitachi", budget: "40", models: [SONNET, HAIKU] },
  { name: "John Deere", budget: "40", models: [SONNET, HAIKU] },
  { name: "Two-Wheeler (TVS / Revolt)", budget: "30", models: [SONNET, HAIKU] },
  { name: "Kaifeng EV", budget: "20", models: [SONNET, HAIKU] },
  { name: "BKT", budget: "15", models: [SONNET, HAIKU] },
  { name: "Manokamana (Finance)", budget: "50", models: [SONNET, HAIKU] },
  { name: "Hydropower", budget: "30", models: [SONNET, HAIKU] },
  { name: "Sumo Cold Chain", budget: "15", models: [SONNET, HAIKU] },
  { name: "FMCG (HoneyMan)", budget: "15", models: [SONNET, HAIKU] },
];

export async function seed(db: PrismaClient) {
  for (const b of BUSINESSES) {
    await db.business.upsert({
      where: { name: b.name },
      update: {},
      create: { name: b.name, monthlyBudgetUsd: b.budget, allowedModels: b.models },
    });
  }

  const group = await db.business.findUniqueOrThrow({ where: { name: "Group / ED Office" } });
  const email = (process.env.SUPER_ADMIN_EMAIL || "shubham@mvdugar.com").toLowerCase();
  await db.user.upsert({
    where: { email },
    // Always make sure the owner can get in, but keep any cap they've set.
    update: { role: "SUPER_ADMIN", status: "ACTIVE" },
    create: {
      email,
      name: process.env.SUPER_ADMIN_NAME || "Shubham Dugar",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      businessId: group.id,
      monthlyCapUsd: "100",
    },
  });
  console.log(`Seeded ${BUSINESSES.length} businesses and super admin ${email}.`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seed(db);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
