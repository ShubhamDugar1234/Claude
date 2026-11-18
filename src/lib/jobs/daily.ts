// The daily housekeeping job. Safe to run more than once a day.
// - Deletes conversations (messages, titles and uploaded files) not touched for RETENTION_DAYS.
//   Usage records are kept for billing.
// - Marks abandoned reservations expired, and removes old sign-in codes and expired sessions.
// Logs counts only, never content.
import type { PrismaClient } from "@/generated/prisma/client";
import { getLimits, type Limits } from "@/config/limits";
import { deleteConversation, deleteUploadedFiles } from "@/lib/chat/conversations";
import type { ClaudeClient } from "@/lib/claude/types";
import { deleteOldLoginCodes } from "@/lib/auth/login-codes";
import { expireStaleReservations } from "@/lib/limits/reserve";

export interface DailyJobResult {
  conversationsDeleted: number;
  filesDeleted: number;
  reservationsExpired: number;
  loginCodesDeleted: number;
  sessionsDeleted: number;
  verificationTokensDeleted: number;
}

const BATCH = 200;

export async function runDailyJobs(
  db: PrismaClient,
  claudeFor: (apiKeyEnvVar: string) => ClaudeClient,
  now = new Date(),
  limits: Limits = getLimits(),
): Promise<DailyJobResult> {
  const cutoff = new Date(now.getTime() - limits.retentionDays * 24 * 60 * 60 * 1000);
  let conversationsDeleted = 0;
  let filesDeleted = 0;

  for (;;) {
    const old = await db.conversation.findMany({
      where: { deletedAt: null, updatedAt: { lt: cutoff } },
      take: BATCH,
      select: {
        id: true,
        userId: true,
        user: { select: { business: { select: { apiKeyEnvVar: true } } } },
      },
    });
    if (old.length === 0) break;
    for (const c of old) {
      const fileIds = await deleteConversation(db, c.userId, c.id);
      if (fileIds === null) continue;
      conversationsDeleted++;
      if (fileIds.length > 0) {
        let client: ClaudeClient | null = null;
        try {
          client = c.user.business ? claudeFor(c.user.business.apiKeyEnvVar) : null;
        } catch {
          // No key configured for this business: the files can't be reached, so skip them.
        }
        await deleteUploadedFiles(client, fileIds);
        if (client) filesDeleted += fileIds.length;
      }
    }
    if (old.length < BATCH) break;
  }

  const [reservationsExpired, loginCodesDeleted, sessions, tokens] = await Promise.all([
    expireStaleReservations(db, now),
    deleteOldLoginCodes(db, now),
    db.session.deleteMany({ where: { expires: { lt: now } } }),
    db.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
  ]);

  return {
    conversationsDeleted,
    filesDeleted,
    reservationsExpired,
    loginCodesDeleted,
    sessionsDeleted: sessions.count,
    verificationTokensDeleted: tokens.count,
  };
}
