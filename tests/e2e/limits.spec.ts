import { expect, test } from "@playwright/test";
import { emailFor, signInOnce } from "./helpers";

const ADMIN = "shubham@mvdugar.com"; // the seeded super admin

// The spec's end-to-end journey: sign in, chat, hit the cap, an admin raises the cap,
// and chat works again. It also checks admins never see what was written.
test("hit the cap, admin raises it, chat works again", async ({ browser }, testInfo) => {
  const userEmail = emailFor(testInfo, "limit");
  const userName = `Lal Limit ${testInfo.project.name}`;
  const SECRET = `Confidential note about dealer margins ${testInfo.project.name}`;

  // 1. Staff member signs in and chats (they have room for one more reply).
  const userContext = await browser.newContext({ ...testInfo.project.use });
  const user = await userContext.newPage();
  await signInOnce(user, userEmail);
  await user.getByLabel("Message").fill(SECRET);
  await user.getByRole("button", { name: "Send" }).click();
  await expect(user.getByText("This is a mock reply")).toBeVisible();

  // 2. The next message hits the cap: it's refused with the plain-words message and kept in the box.
  await user.getByLabel("Message").fill("One more question");
  await user.getByRole("button", { name: "Send" }).click();
  await expect(
    user
      .getByRole("status")
      .filter({ hasText: "You've used your monthly Claude allowance (USD 0.03)" }),
  ).toBeVisible();
  await expect(user.getByLabel("Message")).toHaveValue("One more question");

  // 3. The admin raises the cap from the Usage & limits page.
  const adminContext = await browser.newContext({ ...testInfo.project.use });
  const admin = await adminContext.newPage();
  await signInOnce(admin, ADMIN);
  if (admin.url().includes("/welcome")) {
    await admin.getByRole("button", { name: "I understand, let's start" }).click();
    await admin.waitForURL(/\/chat/);
  }
  await admin.goto("/admin");
  await expect(admin.getByRole("heading", { name: "Usage & limits" })).toBeVisible();
  // No sideways scrolling on any screen size.
  for (const path of ["/admin", "/admin/users", "/admin/audit"]) {
    await admin.goto(path);
    expect(
      await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
  expect(
    await user.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await admin.goto("/admin");
  await expect(admin.getByText(userName).first()).toBeVisible();
  // Admins never see message content.
  await expect(admin.getByText(SECRET)).toHaveCount(0);
  expect(await admin.content()).not.toContain("dealer margins");

  await admin.getByRole("button", { name: `Change monthly cap for ${userName}` }).click();
  await admin.getByLabel(`monthly cap for ${userName}`).fill("1");
  await admin.getByLabel(`monthly cap for ${userName}`).press("Enter");
  await expect(
    admin.getByRole("button", { name: `Change monthly cap for ${userName}` }),
  ).toHaveText("1.00");

  // The change is in the audit log with old and new values.
  await admin.goto("/admin/audit");
  const row = admin
    .getByRole("row")
    .filter({ hasText: userName })
    .filter({ hasText: "Changed cap" })
    .first();
  await expect(row).toContainText("capUsd: 0.03");
  await expect(row).toContainText("capUsd: 1.00");

  // 4. Chat works again straight away.
  await user.getByRole("button", { name: "Send" }).click();
  await expect(user.getByText('You said: "One more question"')).toBeVisible();

  await userContext.close();
  await adminContext.close();
});

test("staff can't open the admin pages or admin API", async ({ page }, testInfo) => {
  await signInOnce(page, emailFor(testInfo, "chat"));
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/chat$/);
  const r = await page.request.get("/api/admin/overview");
  expect(r.status()).toBe(403);
  const r2 = await page.request.patch("/api/admin/users/anyone", {
    data: { monthlyCapUsd: "999" },
  });
  expect(r2.status()).toBe(403);
});
