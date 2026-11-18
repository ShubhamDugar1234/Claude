import { expect, test } from "@playwright/test";

// M0 smoke test. Replaced by the full sign-in → chat → cap → admin flow in M7.
test("home page shows branding", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "MV Dugar AI Portal" })).toBeVisible();
  await expect(page.getByText("Making Visions and Dreams. Since 1884.")).toBeVisible();
});
