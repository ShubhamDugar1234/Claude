// Files attached to a chat message: checked by their actual bytes (not just the name),
// and spreadsheets converted to CSV text so Claude can read them.
//
// PDFs and images are uploaded to Anthropic's Files API (private to the company's account)
// and referenced by id; the portal never stores or serves them. Converted CSV text is kept
// in the user's own message, like the rest of the conversation.
import { unzipSync } from "fflate";
import readXlsxFile from "read-excel-file/node";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Spreadsheets that convert to more text than this are refused (about 75–100K tokens). */
export const MAX_CONVERTED_CHARS = 300_000;
/** Refuse spreadsheets that would unpack to more than this (protects against "zip bombs"). */
const MAX_XLSX_UNPACKED_BYTES = 100 * 1024 * 1024;

export type AttachmentKind = "pdf" | "image" | "spreadsheet" | "csv";

export interface IncomingFile {
  name: string;
  bytes: Buffer;
}

export interface PreparedAttachment {
  name: string;
  kind: AttachmentKind;
  sizeBytes: number;
  /** For PDFs and images: the bytes to upload and their type. */
  upload?: { bytes: Buffer; mediaType: string };
  /** For spreadsheets and CSV files: the text sent to Claude. */
  text?: string;
  /** True when the file was converted to CSV text. */
  converted: boolean;
}

/** What's kept with the message for display. Never includes file contents. */
export interface AttachmentMeta {
  name: string;
  kind: AttachmentKind;
  converted: boolean;
  sizeBytes: number;
}

export class AttachmentError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "AttachmentError";
  }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".xlsx",
  ".csv",
];

/** Keeps a display name safe: no folders, no control characters, at most 100 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "file").slice(0, 100);
}

function startsWith(bytes: Buffer, sig: number[], offset = 0): boolean {
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Works out what a file really is from its first bytes. */
export function sniff(
  bytes: Buffer,
  name: string,
): { kind: AttachmentKind; mediaType: string } | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { kind: "pdf", mediaType: "application/pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "image", mediaType: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mediaType: "image/jpeg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mediaType: "image/gif" };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { kind: "image", mediaType: "image/webp" };
  }
  const lower = name.toLowerCase();
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && lower.endsWith(".xlsx")) {
    return {
      kind: "spreadsheet",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  if (lower.endsWith(".csv") && !bytes.includes(0)) return { kind: "csv", mediaType: "text/csv" };
  return null;
}

/** One CSV field, quoted when needed. */
function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) {
    const iso = v.toISOString();
    s = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  } else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: unknown[][]): string {
  // Drop trailing empty rows, which spreadsheets often carry.
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => c === null || c === undefined || c === "")) end--;
  return rows
    .slice(0, end)
    .map((r) => r.map(csvField).join(","))
    .join("\n");
}

/** Reads CSV bytes as UTF-8 (with or without BOM), falling back to Windows-1252 for older Excel exports. */
export function decodeCsv(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function xlsxToCsv(bytes: Buffer): Promise<string> {
  // Check the unpacked size from the zip index before parsing anything.
  let unpacked = 0;
  try {
    unzipSync(new Uint8Array(bytes), {
      filter(file) {
        unpacked += file.originalSize;
        return false; // don't actually decompress here
      },
    });
  } catch {
    throw new AttachmentError("This Excel file couldn't be opened. Please check it isn't damaged.");
  }
  if (unpacked > MAX_XLSX_UNPACKED_BYTES) {
    throw new AttachmentError(
      "This Excel file is too large to read. Please trim it or split it into smaller files.",
    );
  }

  let sheets;
  try {
    sheets = await readXlsxFile(bytes);
  } catch {
    throw new AttachmentError(
      "This Excel file couldn't be read. Please save it as .xlsx and try again.",
    );
  }
  const parts = sheets
    .map((s) => ({ name: s.sheet, csv: rowsToCsv(s.data as unknown[][]) }))
    .filter((s) => s.csv.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].csv;
  return parts.map((s) => `## Sheet: ${s.name}\n${s.csv}`).join("\n\n");
}

/** Checks and prepares a message's files. Throws AttachmentError with a plain message if any is unacceptable. */
export async function prepareAttachments(files: IncomingFile[]): Promise<PreparedAttachment[]> {
  if (files.length > MAX_FILES)
    throw new AttachmentError(`You can attach up to ${MAX_FILES} files per message.`);
  const prepared: PreparedAttachment[] = [];
  let convertedChars = 0;

  for (const f of files) {
    const name = cleanFileName(f.name);
    if (f.bytes.length === 0) throw new AttachmentError(`"${name}" is empty.`);
    if (f.bytes.length > MAX_FILE_BYTES)
      throw new AttachmentError(`"${name}" is larger than 20 MB.`);
    const type = sniff(f.bytes, name);
    if (!type) {
      throw new AttachmentError(
        `"${name}" isn't a supported file. You can attach PDFs, images (JPG, PNG, GIF, WebP), Excel (.xlsx) and CSV files.`,
      );
    }

    if (type.kind === "pdf" || type.kind === "image") {
      if (type.kind === "image" && !(IMAGE_TYPES as readonly string[]).includes(type.mediaType)) {
        throw new AttachmentError(`"${name}" is an image type Claude can't read.`);
      }
      prepared.push({
        name,
        kind: type.kind,
        sizeBytes: f.bytes.length,
        upload: { bytes: f.bytes, mediaType: type.mediaType },
        converted: false,
      });
      continue;
    }

    const text = type.kind === "spreadsheet" ? await xlsxToCsv(f.bytes) : decodeCsv(f.bytes);
    if (!text.trim()) throw new AttachmentError(`"${name}" has no data in it.`);
    convertedChars += text.length;
    if (convertedChars > MAX_CONVERTED_CHARS) {
      throw new AttachmentError(
        `"${name}" has too much data for one message. Please trim it to the rows and columns you need, or split it.`,
      );
    }
    prepared.push({ name, kind: type.kind, sizeBytes: f.bytes.length, text, converted: true });
  }
  return prepared;
}

export function attachmentMeta(a: PreparedAttachment): AttachmentMeta {
  return { name: a.name, kind: a.kind, converted: a.converted, sizeBytes: a.sizeBytes };
}

/** Anthropic file ids referenced in stored message content (for deleting them later). */
export function fileIdsInContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const b of content as { source?: { type?: string; file_id?: string } }[]) {
    if (b?.source?.type === "file" && typeof b.source.file_id === "string")
      ids.push(b.source.file_id);
  }
  return ids;
}
