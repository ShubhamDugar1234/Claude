import type { MailMessage } from "@/lib/mail";

/** The sign-in email. The code is in the subject so it shows in phone notifications. */
export function codeEmail(to: string, code: string): MailMessage {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    to,
    subject: `${spaced} is your MV Dugar AI Portal code`,
    text: [
      `Your sign-in code is: ${spaced}`,
      "",
      "Type it on the sign-in page. It works once and expires in 10 minutes.",
      "",
      "If you didn't try to sign in, you can ignore this email. Never share this code with anyone.",
      "",
      "MV Dugar Group · Making Visions and Dreams. Since 1884.",
    ].join("\n"),
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1f1f;padding:24px">
<p style="margin:0 0 8px">Your MV Dugar AI Portal sign-in code is:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${spaced}</p>
<p style="margin:0 0 8px">Type it on the sign-in page. It works once and expires in 10 minutes.</p>
<p style="margin:0 0 24px;color:#666">If you didn't try to sign in, you can ignore this email. Never share this code with anyone.</p>
<p style="margin:0;color:#888;font-size:12px">MV Dugar Group · Making Visions and Dreams. Since 1884.</p>
</body></html>`,
  };
}
