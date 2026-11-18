// Who may sign in, decided from the email address alone. Shared by the sign-in form
// (for clear error messages) and the Auth.js signIn callback (as the real gate).

export const DEFAULT_COMPANY_DOMAIN = "mvdugar.com";

export function companyDomain(): string {
  return (process.env.COMPANY_EMAIL_DOMAIN || DEFAULT_COMPANY_DOMAIN).toLowerCase();
}

/** Individual non-company addresses allowed to sign in (ALLOWED_EMAILS, comma-separated). */
export function allowlist(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => e !== null),
  );
}

/**
 * Lower-cases and checks an address. Returns null if it isn't a plain single address.
 * NFKC first, so look-alike characters (e.g. a full-width "@") can't sneak past the checks.
 */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const email = input.normalize("NFKC").trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) return null;
  return email;
}

/** True if the address is on the company domain (exactly, no subdomains) or on the allowlist. */
export function isAllowedEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized.split("@")[1] === companyDomain()) return true;
  return allowlist().has(normalized);
}

export function autoProvisionEnabled(): boolean {
  return process.env.AUTO_PROVISION === "true";
}

export function googleAuthEnabled(): boolean {
  return (
    process.env.ENABLE_GOOGLE_AUTH === "true" &&
    !!process.env.AUTH_GOOGLE_ID &&
    !!process.env.AUTH_GOOGLE_SECRET
  );
}
