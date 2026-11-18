import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { googleAuthEnabled } from "@/lib/auth/email-policy";
import { refusalMessage, type SignInRefusal } from "@/lib/auth/sign-in-policy";
import { SignInForm } from "./signin-form";
import { signInWithGoogle } from "./actions";

export const metadata = { title: "Sign in · MV Dugar AI Portal" };

// Errors can arrive in the URL from Auth.js or from our signIn callback.
function errorFromUrl(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const ours: SignInRefusal[] = ["invalid_email", "not_company_email", "not_added", "deactivated"];
  if ((ours as string[]).includes(code)) return refusalMessage(code as SignInRefusal);
  if (code === "Verification")
    return "That sign-in code has expired or was already used. Please request a new one.";
  return "Something went wrong signing you in. Please try again.";
}

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (await getCurrentUser()) redirect("/chat");
  const { error } = await searchParams;
  const google = googleAuthEnabled();

  return (
    <div className="space-y-6">
      <SignInForm initialError={errorFromUrl(typeof error === "string" ? error : undefined)} />
      {google && (
        <>
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            or
            <span className="h-px flex-1 bg-neutral-200" />
          </div>
          <form action={signInWithGoogle}>
            <button
              type="submit"
              className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-base font-medium"
            >
              Sign in with Google
            </button>
          </form>
        </>
      )}
      <p className="text-center text-xs text-neutral-500">
        For MV Dugar Group staff. Need access? Ask your manager or the ED&apos;s office.
      </p>
    </div>
  );
}
