import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { db } from "@/lib/db";
import { mailFrom, sendMail } from "@/lib/mail";
import { portalAdapter } from "@/lib/auth/adapter";
import { codeEmail } from "@/lib/auth/code-email";
import { companyDomain, googleAuthEnabled, normalizeEmail } from "@/lib/auth/email-policy";
import { CODE_TTL_MS, issueLoginCode } from "@/lib/auth/login-codes";
import { clientIpHash } from "@/lib/auth/client-ip";
import { checkSignIn } from "@/lib/auth/sign-in-policy";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: portalAdapter(db),
  // Sessions live in the database, so pausing or deactivating someone takes effect at once.
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  // The portal runs behind Caddy (or Vercel), which sets the Host header.
  trustHost: true,
  pages: { signIn: "/signin", error: "/signin", verifyRequest: "/signin" },
  providers: [
    Nodemailer({
      id: "nodemailer",
      from: mailFrom(),
      // Required by Auth.js but unused: sendVerificationRequest below sends the mail itself.
      server: { host: "unused.invalid" },
      maxAge: CODE_TTL_MS / 1000,
      normalizeIdentifier(identifier) {
        const email = normalizeEmail(identifier);
        if (!email) throw new Error("Invalid email address");
        return email;
      },
      // Auth.js hands us its long random token. We keep it server-side and email a 6-digit
      // code instead; the code only unlocks the token after passing the attempt limits.
      async sendVerificationRequest({ identifier, token }) {
        const code = await issueLoginCode(db, {
          email: identifier,
          authToken: token,
          ipHash: await clientIpHash().catch(() => null),
        });
        await sendMail(codeEmail(identifier, code));
      },
    }),
    ...(googleAuthEnabled()
      ? [
          Google({
            // Admins add users by email before they first sign in, so a Google sign-in must be
            // able to attach to that existing record. Safe because the domain is checked below
            // and Google confirms the address is verified.
            allowDangerousEmailAccountLinking: true,
            authorization: { params: { hd: companyDomain(), prompt: "select_account" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        // The `hd` hint above only filters Google's account chooser; this is the real check.
        const email = normalizeEmail(profile?.email ?? null);
        if (!profile?.email_verified || !email || email.split("@")[1] !== companyDomain()) {
          return "/signin?error=not_company_email";
        }
      }
      const decision = await checkSignIn(db, user.email ?? "");
      return decision.ok ? true : `/signin?error=${decision.reason}`;
    },
    async session({ session, user }) {
      // Keep the client-visible session minimal. Fresh role/status checks happen in getCurrentUser().
      return { ...session, user: { id: user.id, name: user.name, email: user.email } };
    },
  },
});
