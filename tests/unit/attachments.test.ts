import { describe, expect, it } from "vitest";
import {
  AttachmentError,
  cleanFileName,
  decodeCsv,
  fileIdsInContent,
  MAX_FILE_BYTES,
  prepareAttachments,
  rowsToCsv,
  sniff,
  xlsxToCsv,
} from "@/lib/attachments";
import { makeXlsx, TINY_PDF, TINY_PNG } from "../fixtures/make-xlsx";

describe("file type detection uses the bytes, not the name", () => {
  it("recognises PDFs and images", () => {
    expect(sniff(TINY_PDF, "x.bin")).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    expect(sniff(TINY_PNG, "photo.pdf")).toEqual({ kind: "image", mediaType: "image/png" });
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "a.jpg")?.mediaType).toBe("image/jpeg");
  });

  it("rejects a renamed program or unknown file", () => {
    expect(sniff(Buffer.from("MZ\x90\x00 not a pdf"), "invoice.pdf")).toBeNull();
    expect(sniff(Buffer.from("hello"), "notes.docx")).toBeNull();
  });

  it("needs the .xlsx or .csv name for spreadsheets", () => {
    const xlsx = makeXlsx([{ name: "S", rows: [["a"]] }]);
    expect(sniff(xlsx, "data.xlsx")?.kind).toBe("spreadsheet");
    expect(sniff(xlsx, "data.zip")).toBeNull();
    expect(sniff(Buffer.from("a,b\n1,2"), "data.csv")?.kind).toBe("csv");
  });
});

describe("spreadsheet conversion", () => {
  it("turns a sheet into CSV, quoting where needed", async () => {
    const xlsx = makeXlsx([
      {
        name: "Sales",
        rows: [
          ["Branch", "Units", "Note"],
          ["Butwal", 42, 'said "great"'],
          ["Pokhara, Lakeside", 7, null],
        ],
      },
    ]);
    expect(await xlsxToCsv(xlsx)).toBe(
      'Branch,Units,Note\nButwal,42,"said ""great"""\n"Pokhara, Lakeside",7,',
    );
  });

  it("labels each sheet when there are several, and skips empty ones", async () => {
    const xlsx = makeXlsx([
      { name: "Jan", rows: [["a", 1]] },
      { name: "Empty", rows: [] },
      { name: "Feb", rows: [["b", 2]] },
    ]);
    expect(await xlsxToCsv(xlsx)).toBe("## Sheet: Jan\na,1\n\n## Sheet: Feb\nb,2");
  });

  it("drops trailing empty rows and formats dates", () => {
    expect(
      rowsToCsv([
        [new Date("2026-11-18T00:00:00Z"), "x"],
        [null, ""],
        [null, null],
      ]),
    ).toBe("2026-11-18,x");
  });

  it("reads UTF-8 CSV (with BOM) and older Windows CSV exports", () => {
    expect(decodeCsv(Buffer.from("\uFEFFनाम,रकम\nराम,500"))).toBe("नाम,रकम\nराम,500");
    expect(decodeCsv(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });

  it("refuses a damaged Excel file with a plain message", async () => {
    await expect(xlsxToCsv(Buffer.from("PK\x03\x04garbage"))).rejects.toThrow(AttachmentError);
  });
});

describe("preparing a message's files", () => {
  it("uploads PDFs and images, and converts spreadsheets", async () => {
    const out = await prepareAttachments([
      { name: "report.pdf", bytes: TINY_PDF },
      { name: "photo.png", bytes: TINY_PNG },
      { name: "sales.xlsx", bytes: makeXlsx([{ name: "S", rows: [["a", 1]] }]) },
      { name: "list.csv", bytes: Buffer.from("x,y\n1,2") },
    ]);
    expect(out.map((a) => [a.kind, a.converted, !!a.upload, a.text ?? null])).toEqual([
      ["pdf", false, true, null],
      ["image", false, true, null],
      ["spreadsheet", true, false, "a,1"],
      ["csv", true, false, "x,y\n1,2"],
    ]);
  });

  it("enforces 5 files, 20 MB each, supported types and no empty files", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `${i}.pdf`, bytes: TINY_PDF }));
    await expect(prepareAttachments(six)).rejects.toThrow("up to 5 files");
    const big = Buffer.concat([TINY_PDF, Buffer.alloc(MAX_FILE_BYTES)]);
    await expect(prepareAttachments([{ name: "big.pdf", bytes: big }])).rejects.toThrow(
      "larger than 20 MB",
    );
    await expect(prepareAttachments([{ name: "a.docx", bytes: Buffer.from("x") }])).rejects.toThrow(
      "isn't a supported file",
    );
    await expect(prepareAttachments([{ name: "e.pdf", bytes: Buffer.alloc(0) }])).rejects.toThrow(
      "is empty",
    );
  });

  it("refuses spreadsheets with too much data instead of cutting them short", async () => {
    const huge = Buffer.from(
      Array.from({ length: 40_000 }, (_, i) => `row${i},value${i}`).join("\n"),
    );
    await expect(prepareAttachments([{ name: "huge.csv", bytes: huge }])).rejects.toThrow(
      "too much data",
    );
  });
});

describe("helpers", () => {
  it("clean file names", () => {
    expect(cleanFileName("C:\\Users\\ram\\Desktop\\bill.pdf")).toBe("bill.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("a\u0000b.pdf")).toBe("ab.pdf");
  });

  it("find Anthropic file ids in stored content", () => {
    expect(
      fileIdsInContent([
        { type: "document", source: { type: "file", file_id: "file_1" } },
        { type: "image", source: { type: "file", file_id: "file_2" } },
        { type: "document", source: { type: "text", data: "x" } },
        { type: "text", text: "hi" },
      ]),
    ).toEqual(["file_1", "file_2"]);
  });
});
