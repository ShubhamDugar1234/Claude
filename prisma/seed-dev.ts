// DEVELOPMENT ONLY: fake staff with a month of usage so the admin dashboard has data.
// Refuses to run when NODE_ENV=production. Run with: npm run db:seed:dev
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { calculateCost } from "../src/lib/cost";
import { billingPeriod } from "../src/lib/period";
import { seed } from "./seed";

if (process.env.NODE_ENV === "production") {
  console.error("seed-dev refuses to run in production (NODE_ENV=production).");
  process.exit(1);
}

// Fake people. All addresses start with "dev." so they're easy to spot and remove.
const STAFF: {
  name: string;
  business: string;
  cap?: string;
  role?: "BUSINESS_ADMIN";
  status?: "PAUSED" | "PENDING";
  heavy?: number;
}[] = [
  { name: "Sita Sharma", business: "Mahindra", role: "BUSINESS_ADMIN", heavy: 3 },
  { name: "Ram Thapa", business: "Mahindra", heavy: 8 },
  { name: "Gita Karki", business: "Manokamana (Finance)", heavy: 5 },
  { name: "Hari Adhikari", business: "Manokamana (Finance)", heavy: 10 },
  { name: "Maya Gurung", business: "Tata Hitachi", heavy: 2 },
  { name: "Bikash Shrestha", business: "John Deere", heavy: 4 },
  { name: "Anita Rai", business: "Hydropower", heavy: 3 },
  { name: "Suman Tamang", business: "Two-Wheeler (TVS / Revolt)", status: "PAUSED", heavy: 6 },
  { name: "Puja Magar", business: "FMCG (HoneyMan)", heavy: 1 },
  { name: "Rajesh Joshi", business: "Group / ED Office", cap: "25", heavy: 6 },
  { name: "Nabin Basnet", business: "Sumo Cold Chain", status: "PENDING" },
];

// Small deterministic random generator so every run produces the same data.
let state = 42;
const rand = () => (state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seed(db);
    await db.usageEvent.deleteMany({ where: { user: { email: { startsWith: "dev." } } } });

    const now = new Date();
    const period = billingPeriod(now);
    const span = now.getTime() - period.start.getTime();

    for (const s of STAFF) {
      const business = await db.business.findUniqueOrThrow({ where: { name: s.business } });
      const email = `dev.${s.name.toLowerCase().replace(/\s+/g, ".")}@mvdugar.com`;
      const user = await db.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: s.name,
          role: s.role ?? "STAFF",
          status: s.status ?? "ACTIVE",
          businessId: s.status === "PENDING" ? null : business.id,
          monthlyCapUsd: s.cap ?? "10",
          noticeAcceptedAt: s.status === "PENDING" ? null : now,
        },
      });
      if (!s.heavy) continue;

      const requests = s.heavy * 12;
      let lastActive = period.start;
      for (let i = 0; i < requests; i++) {
        const createdAt = new Date(period.start.getTime() + rand() * span);
        if (createdAt > lastActive) lastActive = createdAt;
        const model = pick(business.allowedModels);
        const roll = rand();
        const status = roll < 0.03 ? "ERROR" : roll < 0.06 ? "BLOCKED" : "OK";
        const usage =
          status === "OK"
            ? {
                input_tokens: 200 + Math.floor(rand() * 4000),
                output_tokens: 100 + Math.floor(rand() * 1500),
                cache_read_input_tokens: rand() < 0.5 ? Math.floor(rand() * 20000) : 0,
                cache_creation_input_tokens: rand() < 0.3 ? Math.floor(rand() * 3000) : 0,
              }
            : { input_tokens: 0, output_tokens: 0 };
        await db.usageEvent.create({
          data: {
            userId: user.id,
            businessId: business.id,
            requestedModel: model,
            model,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
            costUsd: calculateCost(model, usage).total.toDecimalPlaces(8).toString(),
            status,
            errorCode:
              status === "ERROR"
                ? "overloaded_error"
                : status === "BLOCKED"
                  ? "rate_limited"
                  : null,
            durationMs: status === "OK" ? 800 + Math.floor(rand() * 12000) : 0,
            createdAt,
          },
        });
      }
      await db.user.update({ where: { id: user.id }, data: { lastActiveAt: lastActive } });
    }
    console.log(`Seeded ${STAFF.length} fake staff (dev.*@mvdugar.com) with usage for this month.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
