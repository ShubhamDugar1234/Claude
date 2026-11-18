import { expect, test } from "@playwright/test";

test("pages send security headers, including a nonce-based CSP", async ({ request }) => {
  const r = await request.get("/signin");
  const h = r.headers();
  expect(h["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  // A fresh nonce on every request.
  const again = (await request.get("/signin")).headers()["content-security-policy"];
  expect(again).not.toBe(h["content-security-policy"]);
});

test("the page runs under the CSP with no violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/signin");
  await page.getByLabel("Company email").fill("someone@gmail.com");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ending in @mvdugar.com" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("the daily job only runs with the cron secret", async ({ request }) => {
  expect((await request.post("/api/cron/daily")).status()).toBe(401);
  expect(
    (
      await request.post("/api/cron/daily", { headers: { Authorization: "Bearer wrong" } })
    ).status(),
  ).toBe(401);
  const ok = await request.post("/api/cron/daily", {
    headers: { Authorization: "Bearer e2e-cron-secret-0123456789" },
  });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toHaveProperty("conversationsDeleted");
});

test("API routes refuse signed-out requests", async ({ request }) => {
  for (const url of ["/api/conversations", "/api/me/allowance", "/api/admin/overview"]) {
    expect((await request.get(url)).status(), url).toBe(401);
  }
  expect((await request.post("/api/chat", { multipart: { message: "hi" } })).status()).toBe(401);
});
