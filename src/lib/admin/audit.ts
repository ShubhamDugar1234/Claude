import type { TransactionClient } from "@/generated/prisma/internal/prismaNamespace";
import type { PrismaClient } from "@/generated/prisma/client";
import { businessFilter, type AdminScope } from "@/lib/admin/scope";

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.cap_changed"
  | "user.paused"
  | "user.unpaused"
  | "user.deactivated"
  | "user.reactivated"
  | "user.approved"
  | "users.bulk_created"
  | "business.created"
  | "business.updated"
  | "business.budget_changed";

export async function writeAudit(
  tx: TransactionClient,
  entry: {
    actorId: string;
    action: AuditAction;
    targetType: "User" | "Business";
    targetId: string;
    businessId: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      businessId: entry.businessId,
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
    },
  });
}

export async function listAudit(db: PrismaClient, scope: AdminScope, take = 200) {
  const rows = await db.auditLog.findMany({
    where: businessFilter(scope),
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
  // Name the target so the log reads well ("Sita Sharma", "Mahindra").
  const userIds = rows.filter((r) => r.targetType === "User").map((r) => r.targetId);
  const businessIds = rows.filter((r) => r.targetType === "Business").map((r) => r.targetId);
  const [users, businesses] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    db.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...users, ...businesses].map((x) => [x.id, x.name]));
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetName: names.get(r.targetId) ?? (r.targetType === "Business" ? "(business)" : "(user)"),
    before: r.before,
    after: r.after,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actor.name,
    actorEmail: r.actor.email,
  }));
}
