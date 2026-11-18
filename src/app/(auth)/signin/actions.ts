"use server";
import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/email-policy";
import { canSendCode, cleanCode, verifyLoginCode } from "@/lib/auth/login-codes";
import { checkSignIn, refusalMessage } from "@/lib/auth/sign-in-policy";

export interface SignInState {
  step: "email" | "code";
  email?: string;
  error?: string;
  info?: string;
  /** Set when the code is correct: the browser goes here to finish signing in. */
  redirectTo?: string;
}

export async function requestCode(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const typed = String(formData.get("email") ?? "");
  const decision = await checkSignIn(db, typed);
  if (!decision.ok) return { step: "email", email: typed, error: refusalMessage(decision.reason) };

  const { email } = decision;
  if (!(await canSendCode(db, email))) {
    return { step: "email", email, error: refusalMessage("send_limit") };
  }
  try {
    await signIn("nodemailer", { email, redirect: false, redirectTo: "/chat" });
  } catch (e) {
    console.error(
      "[auth] sending sign-in code failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return { step: "email", email, error: refusalMessage("send_failed") };
  }
  return { step: "code", email, info: `We've emailed a 6-digit code to ${email}.` };
}

export async function verifyCode(prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return { step: "email", error: refusalMessage("invalid_email") };
  const code = cleanCode(String(formData.get("code") ?? ""));
  if (!code)
    return { step: "code", email, error: "The code is 6 digits. Please check and try again." };

  const result = await verifyLoginCode(db, { email, code });
  if (!result.ok) {
    if (result.reason === "wrong_code") {
      const tries = result.attemptsLeft === 1 ? "1 try" : `${result.attemptsLeft} tries`;
      return { step: "code", email, error: `That code isn't right. You have ${tries} left.` };
    }
    if (result.reason === "too_many_attempts") {
      return { step: "code", email, error: "Too many wrong tries. Please request a new code." };
    }
    return { step: "code", email, error: "This code has expired. Please request a new one." };
  }

  const params = new URLSearchParams({ token: result.authToken, email, callbackUrl: "/chat" });
  return { step: "code", email, redirectTo: `/api/auth/callback/nodemailer?${params}` };
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/chat" });
}
