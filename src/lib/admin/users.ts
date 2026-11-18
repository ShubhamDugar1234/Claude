// Adding and changing users. Rules:
// - Super admins can manage anyone. Business admins manage STAFF in their own business only,
//   can't change roles or move people between businesses, and can't add admins.
// - Nobody can pause, deactivate or demote themselves (so no one locks themselves out), and
//   the last super admin can't be removed.
// - Every change is written to the audit log in the same transaction.
import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionClient } from "@/generated/prisma/internal/prismaNamespace";
import { getLimits } from "@/config/limits";
import { isAllowedEmail, normalizeEmail } from "@/lib/auth/email-policy";
import { writeAudit, type AuditAction } from "@/lib/admin/audit";
import { AdminError, businessFilter, isSuper, type AdminScope } from "@/lib/admin/scope";
import { money } from "@/lib/money";

export const ROLES = ["STAFF", "BUSINESS_ADMIN", "SUPER_ADMIN"] as const;
export const STATUSES = ["ACTIVE", "PAUSED", "PENDING", "DEACTIVATED"] as const;
type Role = (typeof ROLES)[number];
type Status = (typeof STATUSES)[number];

/** A USD amount like "10" or "12.50" (0 to 100,000). Returns it normalised, or throws. */
export function parseUsd(value: unknown, label: string): string {
  const s =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(s) || money(s).greaterThan(100_000)) {
    throw new AdminError(400, `${label} must be an amount in USD, like 10 or 12.50.`);
  }
  return money(s).toFixed(2);
}

function cleanName(value: unknown): string {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!s || s.length > 100) throw new AdminError(400, "Please enter the person's name.");
  return s;
}

function checkEmail(value: unknown): string {
  const email = normalizeEmail(typeof value === "string" ? value : "");
  if (!email) throw new AdminError(400, "Please enter a valid email address.");
  if (!isAllowedEmail(email)) {
    throw new AdminError(
      400,
      "Only company (@mvdugar.com) addresses, or ones listed in ALLOWED_EMAILS, can sign in.",
    );
  }
  return email;
}

function checkRole(value: unknown): Role {
  if (!(ROLES as readonly unknown[]).includes(value)) throw new AdminError(400, "Unknown role.");
  return value as Role;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  businessId: true,
  monthlyCapUsd: true,
  lastActiveAt: true,
  createdAt: true,
  business: { select: { name: true } },
} as const;

/** Users this admin can see, including pending (super admin) and deactivated ones. */
export async function listUsers(db: PrismaClient, scope: AdminScope) {
  const users = await db.user.findMany({
    where: businessFilter(scope),
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: userSelect,
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    businessId: u.businessId,
    businessName: u.business?.name ?? null,
    capUsd: money(u.monthlyCapUsd).toFixed(2),
    lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
  }));
}

async function checkBusiness(
  tx: TransactionClient | PrismaClient,
  scope: AdminScope,
  businessId: unknown,
) {
  if (typeof businessId !== "string" || !businessId)
    throw new AdminError(400, "Please choose a business.");
  if (!isSuper(scope) && businessId !== scope.businessId) {
    throw new AdminError(403, "You can only add people to your own business.");
  }
  const b = await tx.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!b) throw new AdminError(400, "That business doesn't exist.");
  return businessId;
}

export interface NewUser {
  name: unknown;
  email: unknown;
  businessId: unknown;
  role?: unknown;
  monthlyCapUsd?: unknown;
}

async function createOne(tx: TransactionClient, scope: AdminScope, input: NewUser) {
  const name = cleanName(input.name);
  const email = checkEmail(input.email);
  const businessId = await checkBusiness(tx, scope, input.businessId);
  const role = input.role === undefined || input.role === "" ? "STAFF" : checkRole(input.role);
  if (!isSuper(scope) && role !== "STAFF")
    throw new AdminError(403, "Only the super admin can add admins.");
  const cap =
    input.monthlyCapUsd === undefined || input.monthlyCapUsd === ""
      ? parseUsd(getLimits().defaultUserCapUsd, "Cap")
      : parseUsd(input.monthlyCapUsd, "Cap");

  if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new AdminError(409, `${email} has already been added.`);
  }
  const user = await tx.user.create({
    data: { name, email, businessId, role, monthlyCapUsd: cap, status: "ACTIVE" },
    select: { id: true },
  });
  await writeAudit(tx, {
    actorId: scope.actorId,
    action: "user.created",
    targetType: "User",
    targetId: user.id,
    businessId,
    after: { name, email, businessId, role, capUsd: cap, status: "ACTIVE" },
  });
  return user.id;
}

export async function createUser(db: PrismaClient, scope: AdminScope, input: NewUser) {
  return db.$transaction((tx) => createOne(tx, scope, input));
}

export interface UserPatch {
  name?: unknown;
  businessId?: unknown;
  role?: unknown;
  monthlyCapUsd?: unknown;
  status?: unknown;
}

function statusAction(from: Status, to: Status): AuditAction {
  if (to === "PAUSED") return "user.paused";
  if (to === "DEACTIVATED") return "user.deactivated";
  if (from === "PAUSED") return "user.unpaused";
  if (from === "PENDING") return "user.approved";
  return "user.reactivated";
}

export async function updateUser(
  db: PrismaClient,
  scope: AdminScope,
  id: string,
  patch: UserPatch,
) {
  return db.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id, ...businessFilter(scope) },
      select: userSelect,
    });
    if (!target) throw new AdminError(404, "User not found.");
    const self = target.id === scope.actorId;
    if (!isSuper(scope) && target.role !== "STAFF" && !self) {
      throw new AdminError(403, "Only the super admin can change other admins.");
    }

    const data: Record<string, unknown> = {};
    const audits: {
      action: AuditAction;
      before: unknown;
      after: unknown;
      businessId: string | null;
    }[] = [];
    let businessId = target.businessId;

    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      if (name !== target.name) {
        data.name = name;
        audits.push({
          action: "user.updated",
          before: { name: target.name },
          after: { name },
          businessId,
        });
      }
    }

    if (patch.businessId !== undefined && patch.businessId !== target.businessId) {
      if (!isSuper(scope))
        throw new AdminError(403, "Only the super admin can move people between businesses.");
      businessId = await checkBusiness(tx, scope, patch.businessId);
      data.businessId = businessId;
      audits.push({
        action: "user.updated",
        before: { businessId: target.businessId },
        after: { businessId },
        businessId,
      });
    }

    if (patch.role !== undefined && patch.role !== target.role) {
      if (!isSuper(scope)) throw new AdminError(403, "Only the super admin can change roles.");
      if (self) throw new AdminError(400, "You can't change your own role.");
      const role = checkRole(patch.role);
      if (role === "BUSINESS_ADMIN" && !businessId)
        throw new AdminError(400, "A business admin needs a business.");
      data.role = role;
      audits.push({
        action: "user.updated",
        before: { role: target.role },
        after: { role },
        businessId,
      });
    }

    if (patch.monthlyCapUsd !== undefined) {
      const cap = parseUsd(patch.monthlyCapUsd, "Cap");
      const old = money(target.monthlyCapUsd).toFixed(2);
      if (cap !== old) {
        data.monthlyCapUsd = cap;
        audits.push({
          action: "user.cap_changed",
          before: { capUsd: old },
          after: { capUsd: cap },
          businessId,
        });
      }
    }

    if (patch.status !== undefined && patch.status !== target.status) {
      if (!(STATUSES as readonly unknown[]).includes(patch.status) || patch.status === "PENDING") {
        throw new AdminError(400, "Unknown status.");
      }
      if (self) throw new AdminError(400, "You can't pause or deactivate yourself.");
      const status = patch.status as Status;
      if (status === "ACTIVE" && !businessId) {
        throw new AdminError(400, "Choose a business for this person before approving them.");
      }
      data.status = status;
      audits.push({
        action: statusAction(target.status, status),
        before: { status: target.status },
        after: { status },
        businessId,
      });
    }

    // Never leave the portal without an active super admin.
    if (
      target.role === "SUPER_ADMIN" &&
      (data.role !== undefined || data.status === "DEACTIVATED" || data.status === "PAUSED")
    ) {
      const others = await tx.user.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE", id: { not: target.id } },
      });
      if (others === 0) throw new AdminError(409, "You can't remove the last super admin.");
    }

    if (Object.keys(data).length === 0) return { changed: false };
    await tx.user.update({ where: { id }, data });
    // A deactivated person is signed out everywhere at once.
    if (data.status === "DEACTIVATED") await tx.session.deleteMany({ where: { userId: id } });
    for (const a of audits) {
      await writeAudit(tx, {
        actorId: scope.actorId,
        action: a.action,
        targetType: "User",
        targetId: id,
        businessId: a.businessId,
        before: a.before,
        after: a.after,
      });
    }
    return { changed: true };
  });
}

/** Splits one CSV line, honouring quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\t") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export interface BulkResult {
  created: number;
  errors: { line: number; message: string }[];
}

/**
 * Adds many people from pasted CSV: name, email, business, cap (header optional; cap optional,
 * business optional for business admins). All-or-nothing: if any line has a problem, nothing
 * is added and every problem is listed.
 */
export async function bulkCreateUsers(
  db: PrismaClient,
  scope: AdminScope,
  csv: string,
): Promise<BulkResult> {
  const lines = csv
    .split(/\r?\n/)
    .map((l, i) => ({ text: l.trim(), line: i + 1 }))
    .filter((l) => l.text);
  if (lines.length > 0 && /^name\s*[,\t]\s*email/i.test(lines[0].text)) lines.shift();
  if (lines.length === 0)
    return { created: 0, errors: [{ line: 0, message: "Paste at least one line." }] };
  if (lines.length > 500)
    return { created: 0, errors: [{ line: 0, message: "Add at most 500 people at a time." }] };

  const businesses = await db.business.findMany({
    where: scope.businessId ? { id: scope.businessId } : {},
    select: { id: true, name: true },
  });
  const byName = new Map(businesses.map((b) => [b.name.toLowerCase(), b.id]));
  const seen = new Set<string>();
  const rows: NewUser[] = [];
  const errors: BulkResult["errors"] = [];

  for (const { text, line } of lines) {
    const [name, email, businessName, cap] = splitCsvLine(text);
    try {
      const businessId = businessName
        ? byName.get(businessName.toLowerCase())
        : isSuper(scope)
          ? undefined
          : scope.businessId!;
      if (!businessId) {
        throw new AdminError(
          400,
          businessName ? `Unknown business "${businessName}".` : "Business is missing.",
        );
      }
      const normalized = checkEmail(email);
      if (seen.has(normalized)) throw new AdminError(400, `${normalized} appears twice.`);
      seen.add(normalized);
      cleanName(name);
      if (cap) parseUsd(cap, "Cap");
      if (await db.user.findUnique({ where: { email: normalized }, select: { id: true } })) {
        throw new AdminError(409, `${normalized} has already been added.`);
      }
      rows.push({ name, email: normalized, businessId, monthlyCapUsd: cap || undefined });
    } catch (e) {
      errors.push({
        line,
        message: e instanceof AdminError ? e.message : "Couldn't read this line.",
      });
    }
  }
  if (errors.length > 0) return { created: 0, errors };

  await db.$transaction(async (tx) => {
    for (const r of rows) await createOne(tx, scope, r);
  });
  return { created: rows.length, errors: [] };
}
