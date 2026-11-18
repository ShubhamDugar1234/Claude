// Who an admin is allowed to see and change. Every admin query and change goes through a
// scope: super admins see everything; business admins see only their own business.
//
// PRIVACY: nothing under lib/admin may read the Message table or conversation titles.

export type AdminRole = "SUPER_ADMIN" | "BUSINESS_ADMIN";

export interface AdminScope {
  actorId: string;
  role: AdminRole;
  /** The business admin's own business. Null for super admins (they're not limited to one). */
  businessId: string | null;
}

export class AdminError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export function scopeFor(user: {
  id: string;
  role: string;
  status: string;
  businessId: string | null;
}): AdminScope | null {
  if (user.status !== "ACTIVE" && user.status !== "PAUSED") return null;
  if (user.role === "SUPER_ADMIN")
    return { actorId: user.id, role: "SUPER_ADMIN", businessId: null };
  if (user.role === "BUSINESS_ADMIN" && user.businessId) {
    return { actorId: user.id, role: "BUSINESS_ADMIN", businessId: user.businessId };
  }
  return null;
}

export const isSuper = (s: AdminScope) => s.role === "SUPER_ADMIN";

/** Prisma filter for rows that belong to businesses this admin may see. */
export function businessFilter(s: AdminScope): { businessId?: string } {
  return isSuper(s) ? {} : { businessId: s.businessId! };
}

export function requireSuper(s: AdminScope) {
  if (!isSuper(s)) throw new AdminError(403, "Only the super admin can do this.");
}
