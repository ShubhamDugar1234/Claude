// The single rule for who may sign in. Used by the sign-in form (to explain a refusal) and
// by the Auth.js signIn callback (which enforces it on every sign-in, whatever the method).
import type { PrismaClient } from "@/generated/prisma/client";
import { autoProvisionEnabled, isAllowedEmail, normalizeEmail } from "@/lib/auth/email-policy";

export type SignInRefusal = "invalid_email" | "not_company_email" | "not_added" | "deactivated";

export type SignInDecision =
  { ok: true; email: string; exists: boolean } | { ok: false; reason: SignInRefusal };

export async function checkSignIn(db: PrismaClient, rawEmail: string): Promise<SignInDecision> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: "invalid_email" };
  if (!isAllowedEmail(email)) return { ok: false, reason: "not_company_email" };

  const user = await db.user.findUnique({ where: { email }, select: { status: true } });
  if (!user)
    return autoProvisionEnabled()
      ? { ok: true, email, exists: false }
      : { ok: false, reason: "not_added" };
  if (user.status === "DEACTIVATED") return { ok: false, reason: "deactivated" };
  // ACTIVE, PAUSED and PENDING users can sign in; PAUSED and PENDING see why they can't chat.
  return { ok: true, email, exists: true };
}

export function refusalMessage(reason: SignInRefusal | "send_limit" | "send_failed"): string {
  switch (reason) {
    case "invalid_email":
      return "Please enter a valid email address.";
    case "not_company_email":
      return "Please use your company email address (ending in @mvdugar.com).";
    case "not_added":
      return "This email hasn't been added to the portal yet. Ask your manager or the ED's office to add you.";
    case "deactivated":
      return "This account has been deactivated. Ask your manager or the ED's office if you need access again.";
    case "send_limit":
      return "Too many codes have been sent to this address. Please wait an hour and try again.";
    case "send_failed":
      return "We couldn't send the email just now. Please try again in a few minutes.";
  }
}
