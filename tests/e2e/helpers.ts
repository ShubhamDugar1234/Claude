import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

const OUTBOX = path.resolve(".e2e/outbox");

export const emailFor = (testInfo: TestInfo, who: "staff" | "pending" | "gone") =>
  `e2e.${testInfo.project.name}.${who}@mvdugar.com`;

/** Waits for the newest sign-in email to this address and returns its 6-digit code. */
export async function latestCode(to: string, after: number): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = (await readdir(OUTBOX)).sort().reverse();
    for (const f of files) {
      if (Number(f.split("-")[0]) < after) continue;
      const mail = JSON.parse(await readFile(path.join(OUTBOX, f), "utf8"));
      if (mail.to !== to) continue;
      const m = /(\d{3}) (\d{3})/.exec(mail.subject);
      if (m) return m[1] + m[2];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No sign-in email for ${to}`);
}

export async function requestCode(page: Page, email: string): Promise<number> {
  const sentAfter = Date.now();
  await page.goto("/signin");
  await page.getByLabel("Company email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText(`We've emailed a 6-digit code to ${email}`)).toBeVisible();
  return sentAfter;
}

export async function signIn(page: Page, email: string) {
  const sentAfter = await requestCode(page, email);
  await page.getByLabel("6-digit code").fill(await latestCode(email, sentAfter));
  await page.getByRole("button", { name: "Sign in" }).click();
}
