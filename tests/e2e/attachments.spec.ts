import { expect, test } from "@playwright/test";
import { emailFor, signInOnce } from "./helpers";
import { makeXlsx, TINY_PDF } from "../fixtures/make-xlsx";

test("attach a PDF and an Excel file; the spreadsheet is converted and Claude gets both", async ({
  page,
}, testInfo) => {
  await signInOnce(page, emailFor(testInfo, "chat"));
  await page
    .getByLabel("Attach files")
    .first()
    .setInputFiles([
      { name: "quarterly-report.pdf", mimeType: "application/pdf", buffer: TINY_PDF },
      {
        name: "branch-sales.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: makeXlsx([
          {
            name: "Sales",
            rows: [
              ["Branch", "Units"],
              ["Butwal", 42],
            ],
          },
        ]),
      },
    ]);
  const pending = page.getByRole("list", { name: "Files to send" });
  await expect(pending.getByText("quarterly-report.pdf")).toBeVisible();
  await expect(pending.getByText("branch-sales.xlsx")).toBeVisible();

  // Remove and re-add works; then send with a question.
  await page.getByRole("button", { name: "Remove quarterly-report.pdf" }).click();
  await expect(pending.getByText("quarterly-report.pdf")).toHaveCount(0);
  await page
    .getByLabel("Attach files")
    .first()
    .setInputFiles([
      { name: "quarterly-report.pdf", mimeType: "application/pdf", buffer: TINY_PDF },
    ]);
  await page.getByLabel("Message").fill("Summarise these");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("I received 2 attachment(s)")).toBeVisible();
  await expect(
    page.getByText("branch-sales.xlsx was converted to CSV text so Claude can read it."),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Files to send" })).toHaveCount(0);

  // Still shown after a reload.
  await page.reload();
  const sent = page.getByRole("list", { name: "Attached files" });
  await expect(sent.getByText("quarterly-report.pdf")).toBeVisible();
  await expect(
    page.getByText("branch-sales.xlsx was converted to CSV text so Claude can read it."),
  ).toBeVisible();
});

test("unsupported and disguised files are refused with a clear message", async ({
  page,
}, testInfo) => {
  await signInOnce(page, emailFor(testInfo, "chat"));
  // Wrong extension: refused in the browser.
  await page
    .getByLabel("Attach files")
    .first()
    .setInputFiles([
      { name: "letter.docx", mimeType: "application/octet-stream", buffer: Buffer.from("x") },
    ]);
  await expect(page.getByRole("status").filter({ hasText: "isn't supported" })).toBeVisible();

  // Right extension, wrong contents: refused by the server, and the message is kept.
  await page
    .getByLabel("Attach files")
    .first()
    .setInputFiles([
      {
        name: "invoice.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("MZ this is not a pdf"),
      },
    ]);
  await page.getByLabel("Message").fill("Check this invoice");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: '"invoice.pdf" isn\'t a supported file' }),
  ).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("Check this invoice");
  await expect(
    page.getByRole("list", { name: "Files to send" }).getByText("invoice.pdf"),
  ).toBeVisible();
});
