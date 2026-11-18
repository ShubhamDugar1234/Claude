import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowlist, isAllowedEmail, normalizeEmail } from "@/lib/auth/email-policy";
import { cleanCode, generateCode, hashCode } from "@/lib/auth/login-codes";
import { nameFromEmail } from "@/lib/auth/adapter";
import { codeEmail } from "@/lib/auth/code-email";

const saved = { ...process.env };
beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.ALLOWED_EMAILS;
  delete process.env.COMPANY_EMAIL_DOMAIN;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("email normalisation", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Ram.Thapa@MVDugar.com ")).toBe("ram.thapa@mvdugar.com");
  });

  it("rejects things that aren't a single plain address", () => {
    for (const bad of [
      "",
      "ram",
      "ram@",
      "@mvdugar.com",
      "a@b@mvdugar.com",
      '"x"@mvdugar.com',
      "a b@mvdugar.com",
      "ram@mvdugar.com,evil@x.com",
    ]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("turns a full-width @ look-alike into a real @ before checking", () => {
    expect(normalizeEmail("ram＠mvdugar.com")).toBe("ram@mvdugar.com");
  });
});

describe("who may sign in, by address", () => {
  it("accepts the company domain only, not look-alike or sub-domains", () => {
    expect(isAllowedEmail("ram@mvdugar.com")).toBe(true);
    expect(isAllowedEmail("ram@MVDUGAR.COM")).toBe(true);
    expect(isAllowedEmail("ram@gmail.com")).toBe(false);
    expect(isAllowedEmail("ram@evilmvdugar.com")).toBe(false);
    expect(isAllowedEmail("ram@mvdugar.com.evil.com")).toBe(false);
    expect(isAllowedEmail("ram@mail.mvdugar.com")).toBe(false);
  });

  it("also accepts individually allowlisted addresses", () => {
    process.env.ALLOWED_EMAILS = " Consultant@Gmail.com, , other@example.org ";
    expect([...allowlist()]).toEqual(["consultant@gmail.com", "other@example.org"]);
    expect(isAllowedEmail("consultant@gmail.com")).toBe(true);
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
  });

  it("can be pointed at another domain", () => {
    process.env.COMPANY_EMAIL_DOMAIN = "example.com";
    expect(isAllowedEmail("a@example.com")).toBe(true);
    expect(isAllowedEmail("a@mvdugar.com")).toBe(false);
  });
});

describe("sign-in codes", () => {
  it("are always 6 digits", () => {
    for (let i = 0; i < 1000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("accept spaces and dashes when typed", () => {
    expect(cleanCode("042 917")).toBe("042917");
    expect(cleanCode("042-917")).toBe("042917");
    expect(cleanCode("04291")).toBeNull();
    expect(cleanCode("abcdef")).toBeNull();
  });

  it("hash differently per address and per secret", () => {
    const a = hashCode("a@mvdugar.com", "123456");
    expect(hashCode("b@mvdugar.com", "123456")).not.toBe(a);
    process.env.AUTH_SECRET = "other";
    expect(hashCode("a@mvdugar.com", "123456")).not.toBe(a);
  });

  it("are sent with the code in the subject and body", () => {
    const m = codeEmail("ram@mvdugar.com", "042917");
    expect(m.subject).toContain("042 917");
    expect(m.text).toContain("042 917");
    expect(m.html).toContain("042 917");
  });
});

describe("placeholder names for auto-added users", () => {
  it("come from the email address", () => {
    expect(nameFromEmail("ram.bahadur@mvdugar.com")).toBe("Ram Bahadur");
    expect(nameFromEmail("sita_k@mvdugar.com")).toBe("Sita K");
  });
});
