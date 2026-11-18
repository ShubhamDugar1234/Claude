// Static checks that keep secrets and message content where they belong.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/proxy";

const SRC = path.resolve(__dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (p.includes(`${path.sep}generated${path.sep}`)) return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const all = files(SRC).map((p) => ({ p: path.relative(SRC, p), text: readFileSync(p, "utf8") }));

describe("Content Security Policy", () => {
  it("only allows the app's own scripts, with a nonce, and blocks framing", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(buildCsp("x", true)).toContain("'unsafe-eval'"); // development only
  });
});

describe("secrets never reach the browser", () => {
  it("modules that touch keys, the database or mail are marked server-only", () => {
    for (const f of [
      "lib/db.ts",
      "lib/claude/index.ts",
      "lib/claude/real.ts",
      "lib/mail.ts",
      "lib/session.ts",
      "lib/api.ts",
      "lib/admin/guard.ts",
      "lib/auth/client-ip.ts",
    ]) {
      expect(readFileSync(path.join(SRC, f), "utf8"), f).toMatch(/^import "server-only";/m);
    }
  });

  it("browser code doesn't import server modules (type-only imports are fine)", () => {
    const server =
      /from "@\/(lib\/db|lib\/claude(\/(index|real))?|auth|lib\/mail|lib\/session|lib\/api|lib\/admin\/(guard|users|businesses|overview|audit)|lib\/limits\/reserve|lib\/chat\/service|lib\/jobs\/daily)"/;
    for (const { p, text } of all) {
      if (!/^["']use client["']/m.test(text)) continue;
      const bad = text
        .split("\n")
        .filter((l) => /^import /.test(l) && !/^import type /.test(l) && server.test(l));
      expect(bad, p).toEqual([]);
    }
  });

  it("no NEXT_PUBLIC_ variables (they'd be copied into the browser bundle)", () => {
    for (const { p, text } of all) expect(text.includes("NEXT_PUBLIC_"), p).toBe(false);
  });
});

describe("logs never contain message content or secrets", () => {
  it("console calls only log fixed text, codes and counts", () => {
    const risky =
      /\b(text|content|messages?|prompt|system|body|apiKey|key|token|code|email|attachments?|title|name)\b/;
    for (const { p, text } of all) {
      if (p === "lib/mail.ts") continue; // the dev-only console transport, which refuses to run in production
      for (const m of text.matchAll(/console\.(log|info|warn|error)\(([^;]*?)\);/gs)) {
        // Strip string literals; what's left is the logged variables.
        const args = m[2].replace(/`[^`]*`|"[^"]*"|'[^']*'/g, (s) =>
          s.startsWith("`") ? (s.match(/\$\{[^}]*\}/g) ?? []).join(" ") : "",
        );
        expect(
          risky.test(args) ? `${p}: ${m[0]}` : "",
          "logs something that could hold content",
        ).toBe("");
      }
    }
  });
});
