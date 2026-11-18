import { expect, test, type Page } from "@playwright/test";
import { emailFor, signIn } from "./helpers";

async function openMenuIfMobile(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("chat: send a message, see the streamed reply with its cost, and find it again", async ({
  page,
}, testInfo) => {
  await signIn(page, emailFor(testInfo, "chat"));
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText(/USD 0\.00 of USD 10\.00 used this month/)).toBeVisible();

  await send(page, "Draft a thank-you note for the Butwal dealers");
  await expect(page.getByText("This is a mock reply from claude-sonnet-5-5")).toBeVisible();
  await expect(page.getByText("console.log('hello from the mock');")).toBeVisible();
  await expect(page.getByTestId("usage-line")).toHaveText(/^[\d,]+ in · [\d,]+ out · (\$|<\$)/);
  await expect(page).toHaveURL(/\/chat\/[a-z0-9]+$/);

  // It's in the sidebar, and still there after a reload.
  await page.reload();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Draft a thank-you note for the Butwal dealers" })
      .last(),
  ).toBeVisible();
  await expect(page.getByText("This is a mock reply from claude-sonnet-5-5")).toBeVisible();
  await openMenuIfMobile(page);
  await expect(
    page
      .getByRole("navigation", { name: "Your chats" })
      .getByRole("button", { name: "Draft a thank-you note for the Butwal dealers", exact: true }),
  ).toBeVisible();
});

test("chat: rename and delete a conversation", async ({ page }, testInfo) => {
  await signIn(page, emailFor(testInfo, "chat"));
  await send(page, "Temporary question about tractors");
  await expect(page.getByTestId("usage-line")).toBeVisible();

  await openMenuIfMobile(page);
  const nav = page.getByRole("navigation", { name: "Your chats" });
  await nav.getByRole("button", { name: 'Rename "Temporary question about tractors"' }).click();
  await nav.getByLabel("Chat name").fill("Tractor notes");
  await nav.getByLabel("Chat name").press("Enter");
  await expect(nav.getByRole("button", { name: "Tractor notes", exact: true })).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await nav.getByRole("button", { name: 'Delete "Tractor notes"' }).click();
  await expect(nav.getByRole("button", { name: "Tractor notes", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/chat$/);
});

test("chat: the Stop button ends a reply early", async ({ page }, testInfo) => {
  await signIn(page, emailFor(testInfo, "chat"));
  await send(page, "MOCK_SLOW please");
  await expect(page.getByText("word3")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Stopped.")).toBeVisible();
  await expect(page.getByText("word60")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("chat: a failed reply shows a plain message", async ({ page }, testInfo) => {
  await signIn(page, emailFor(testInfo, "chat"));
  await send(page, "MOCK_ERROR");
  await expect(page.getByText("Claude is very busy at the moment.")).toBeVisible();
});

test("chat: a user over their cap sees why and can't send", async ({ page }, testInfo) => {
  await signIn(page, emailFor(testInfo, "capped"));
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "You've used your monthly Claude allowance (USD 0.01)" }),
  ).toBeVisible();
  await expect(page.getByLabel("Message")).toBeDisabled();
  await expect(page.getByText("USD 0.01 of USD 0.01 used this month")).toBeVisible();
});
