// 6-digit sign-in codes. The code is emailed; only its hash is stored. A correct code unlocks
// the long random Auth.js token stored next to it, which is what actually signs the person in.
// Limits: a code lasts 10 minutes and allows 5 wrong tries; at most 5 codes per address per hour.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS_PER_CODE = 5;
export const MAX_CODES_PER_HOUR = 5;

type Db = PrismaClient;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

/** Uniformly random 6-digit code, e.g. "042917". */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}\n${code}\n${secret()}`).digest("hex");
}

/** Spaces and dashes are allowed when typing ("042 917"); anything else isn't a code. */
export function cleanCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export async function canSendCode(db: Db, email: string, now = new Date()): Promise<boolean> {
  const recent = await db.loginCode.count({
    where: { email, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  return recent < MAX_CODES_PER_HOUR;
}

export async function issueLoginCode(
  db: Db,
  input: { email: string; authToken: string; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  const code = generateCode();
  await db.loginCode.create({
    data: {
      email: input.email,
      codeHash: hashCode(input.email, code),
      authToken: input.authToken,
      expires: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    },
  });
  return code;
}

export type VerifyResult =
  | { ok: true; authToken: string }
  | { ok: false; reason: "wrong_code"; attemptsLeft: number }
  | { ok: false; reason: "expired" | "too_many_attempts" };

/** Checks a typed code against the most recent unused code for this address. */
export async function verifyLoginCode(
  db: Db,
  input: { email: string; code: string; now?: Date },
): Promise<VerifyResult> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    // Lock the newest code so parallel guesses are counted one at a time.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LoginCode"
      WHERE email = ${input.email} AND "usedAt" IS NULL
      ORDER BY "createdAt" DESC LIMIT 1
      FOR UPDATE`;
    if (rows.length === 0) return { ok: false, reason: "expired" } as const;
    const row = await tx.loginCode.findUniqueOrThrow({ where: { id: rows[0].id } });

    if (row.expires <= now) return { ok: false, reason: "expired" } as const;
    if (row.attempts >= MAX_ATTEMPTS_PER_CODE)
      return { ok: false, reason: "too_many_attempts" } as const;

    const expected = Buffer.from(row.codeHash, "hex");
    const actual = Buffer.from(hashCode(input.email, input.code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = row.attempts + 1;
      await tx.loginCode.update({ where: { id: row.id }, data: { attempts } });
      if (attempts >= MAX_ATTEMPTS_PER_CODE)
        return { ok: false, reason: "too_many_attempts" } as const;
      return {
        ok: false,
        reason: "wrong_code",
        attemptsLeft: MAX_ATTEMPTS_PER_CODE - attempts,
      } as const;
    }

    await tx.loginCode.update({ where: { id: row.id }, data: { usedAt: now } });
    return { ok: true, authToken: row.authToken } as const;
  });
}

/** Housekeeping for the daily job: codes are useless an hour after they were created. */
export async function deleteOldLoginCodes(db: Db, now = new Date()): Promise<number> {
  const r = await db.loginCode.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  return r.count;
}
