// Our own Auth.js database adapter (the official Prisma adapter doesn't support Prisma 7).
// It also enforces portal rules: users are only created when AUTO_PROVISION is on (and then
// as PENDING), profile data from Google never overwrites admin-set names, and a deactivated
// user's sessions stop working immediately.
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { PrismaClient } from "@/generated/prisma/client";
import { getLimits } from "@/config/limits";
import { autoProvisionEnabled } from "@/lib/auth/email-policy";

type Db = PrismaClient;

interface UserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: Date | null;
}

const userSelect = { id: true, name: true, email: true, emailVerified: true } as const;

function toAdapterUser(u: UserRow): AdapterUser {
  return { id: u.id, name: u.name, email: u.email, emailVerified: u.emailVerified, image: null };
}

/** "ram.bahadur@mvdugar.com" -> "Ram Bahadur": a placeholder until an admin sets the real name. */
export function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

export function portalAdapter(db: Db): Adapter {
  return {
    async createUser(user) {
      if (!autoProvisionEnabled()) {
        throw new Error("New users must be added by an admin (AUTO_PROVISION is off)");
      }
      const email = user.email.toLowerCase();
      const created = await db.user.create({
        data: {
          email,
          name: nameFromEmail(email),
          emailVerified: user.emailVerified ?? null,
          status: "PENDING",
          role: "STAFF",
          monthlyCapUsd: getLimits().defaultUserCapUsd,
        },
        select: userSelect,
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      const u = await db.user.findUnique({ where: { id }, select: userSelect });
      return u ? toAdapterUser(u) : null;
    },

    async getUserByEmail(email) {
      const u = await db.user.findUnique({
        where: { email: email.toLowerCase() },
        select: userSelect,
      });
      return u ? toAdapterUser(u) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { user: { select: userSelect } },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser({ id, emailVerified }) {
      // Only the verification time is taken from the sign-in. Names are managed by admins.
      const u = await db.user.update({
        where: { id },
        data: emailVerified !== undefined ? { emailVerified } : {},
        select: userSelect,
      });
      return toAdapterUser(u);
    },

    async linkAccount(account: AdapterAccount) {
      await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refresh_token: account.refresh_token ?? null,
          access_token: account.access_token ?? null,
          expires_at: account.expires_at ?? null,
          token_type: account.token_type ?? null,
          scope: account.scope ?? null,
          id_token: account.id_token ?? null,
          session_state: typeof account.session_state === "string" ? account.session_state : null,
        },
      });
    },

    async createSession(session) {
      const s = await db.session.create({ data: session });
      return { sessionToken: s.sessionToken, userId: s.userId, expires: s.expires };
    },

    async getSessionAndUser(sessionToken) {
      const s = await db.session.findUnique({
        where: { sessionToken },
        select: {
          sessionToken: true,
          userId: true,
          expires: true,
          user: { select: { ...userSelect, status: true } },
        },
      });
      if (!s) return null;
      if (s.user.status === "DEACTIVATED") {
        await db.session.deleteMany({ where: { userId: s.userId } });
        return null;
      }
      const session: AdapterSession = {
        sessionToken: s.sessionToken,
        userId: s.userId,
        expires: s.expires,
      };
      return { session, user: toAdapterUser(s.user) };
    },

    async updateSession({ sessionToken, expires }) {
      const s = await db.session.update({
        where: { sessionToken },
        data: expires ? { expires } : {},
      });
      return { sessionToken: s.sessionToken, userId: s.userId, expires: s.expires };
    },

    async deleteSession(sessionToken) {
      await db.session.deleteMany({ where: { sessionToken } });
    },

    async createVerificationToken(token) {
      await db.verificationToken.create({ data: token });
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      // Delete-and-return makes each token single-use.
      try {
        return await db.verificationToken.delete({
          where: { identifier_token: { identifier, token } },
        });
      } catch {
        return null;
      }
    },
  };
}
