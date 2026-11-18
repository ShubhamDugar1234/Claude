import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTransport } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type TransportKind = "smtp" | "console" | "file";

function transportKind(): TransportKind {
  const kind = (process.env.MAIL_TRANSPORT ||
    (process.env.NODE_ENV === "production" ? "smtp" : "console")) as TransportKind;
  if (!["smtp", "console", "file"].includes(kind))
    throw new Error(`Unknown MAIL_TRANSPORT "${kind}"`);
  // "console" and "file" expose sign-in codes. Never allow them on a live server by accident.
  if (
    kind !== "smtp" &&
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_TEST_MAIL_TRANSPORT !== "true"
  ) {
    throw new Error(`MAIL_TRANSPORT=${kind} is for development and tests only`);
  }
  return kind;
}

let smtp: ReturnType<typeof createTransport> | null = null;

function smtpTransport(): ReturnType<typeof createTransport> {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT || 587);
    smtp = createTransport({
      host: process.env.SMTP_HOST,
      port,
      // Port 465 uses TLS from the start; 587 upgrades with STARTTLS (required, not optional).
      secure: port === 465,
      requireTLS: port !== 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return smtp;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || "MV Dugar AI Portal <noreply@mvdugar.com>";
}

export async function sendMail(message: MailMessage): Promise<void> {
  const kind = transportKind();
  if (kind === "smtp") {
    await smtpTransport().sendMail({ from: mailFrom(), ...message });
    return;
  }
  if (kind === "console") {
    console.info(`\n[mail] to ${message.to}\n[mail] ${message.subject}\n${message.text}\n`);
    return;
  }
  // "file": one JSON file per message, read by the end-to-end tests.
  const dir = process.env.MAIL_OUTBOX_DIR || ".mail-outbox";
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await writeFile(path.join(dir, name), JSON.stringify(message));
}
