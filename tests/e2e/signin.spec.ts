import { expect, test } from "@playwright/test";
import { emailFor, latestCode, requestCode, signIn } from "./helpers";

test("shows branding on the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByText("Making Visions and Dreams. Since 1884.")).toBeVisible();
});

test("refuses addresses outside the company domain", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Company email").fill("someone@gmail.com");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "ending in @mvdugar.com" })).toBeVisible();
});

test("refuses company addresses that haven't been added", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Company email").fill("not.added@mvdugar.com");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "hasn't been added to the portal yet" }),
  ).toBeVisible();
});

test("refuses deactivated accounts", async ({ page }, testInfo) => {
  await page.goto("/signin");
  await page.getByLabel("Company email").fill(emailFor(testInfo, "gone"));
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "deactivated" })).toBeVisible();
});

test("a wrong code says how many tries are left", async ({ page }, testInfo) => {
  const email = emailFor(testInfo, "staff");
  const sentAfter = await requestCode(page, email);
  const code = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "You have 4 tries left" })).toBeVisible();
});

test("staff sign in with an emailed code, accept the notice once, and sign out", async ({
  page,
}, testInfo) => {
  await signIn(page, emailFor(testInfo, "staff"));

  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("Your chats are private.")).toBeVisible();
  await page.getByRole("button", { name: "I understand, let's start" }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Signed in as Asha Staff" })).toBeVisible();

  // The notice isn't shown again.
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/chat$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/signin$/);
});

test("pending users see that they're waiting for approval", async ({ page }, testInfo) => {
  await signIn(page, emailFor(testInfo, "pending"));
  await expect(page).toHaveURL(/\/pending$/);
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/pending$/);
});
