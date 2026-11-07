import type { EmailMessage } from "./email";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type Content = Omit<EmailMessage, "to">;

const SERIF = "Georgia,'Times New Roman',Times,serif";

/** The sign-in code email. Malay first, English second; tables and inline styles because that is what mail programs render reliably. */
export function otpEmail(code: string, minutes: number): Content {
  const subject = `Kod log masuk Warkah Kad: ${code}`;
  const text =
    `Salam sejahtera,\n\n` +
    `Kami menerima permintaan log masuk ke akaun Warkah Kad anda. Kod pengesahan anda: ${code}\nSah selama ${minutes} minit. Jangan kongsi kod ini.\n\n` +
    `Your sign-in code: ${code}\nValid for ${minutes} minutes. Do not share it.\n\n` +
    `Jika anda tidak memintanya, abaikan e-mel ini. / If you did not request this, ignore this email.\n\n` +
    `Yang benar,\nPasukan Warkah Kad`;
  const html =
    `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Warkah Kad</title></head>` +
    `<body style="margin:0;padding:0;background:#EFE7DA"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 12px">` +
    `<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background:#FFFFFF;border:1px solid #E0D4C0"><tr><td style="padding:32px 28px;font-family:${SERIF};color:#2B211C">` +
    `<p style="margin:0 0 4px;font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#6B5A50">Warkah Kad</p>` +
    `<h1 style="margin:0 0 18px;font-size:22px;color:#6B2119">Kod pengesahan log masuk</h1>` +
    `<p style="margin:0 0 14px;font-size:16px;line-height:24px">Salam sejahtera, sila masukkan kod di bawah untuk log masuk ke akaun Warkah Kad anda.</p>` +
    `<div style="margin:6px 0 18px;padding:18px 12px;text-align:center;background:#FBF7F0;border:1px solid #B98A3E;font-size:36px;letter-spacing:12px;font-weight:bold;color:#6B2119">${escapeHtml(code)}</div>` +
    `<p style="margin:0 0 14px;font-size:15px;line-height:23px">Sah selama ${minutes} minit. Jangan kongsi kod ini dengan sesiapa.</p>` +
    `<p style="margin:0 0 18px;font-size:13px;line-height:20px;color:#6B5A50">Jika anda tidak memintanya, abaikan e-mel ini.</p>` +
    `<p style="margin:0;font-size:14px;line-height:22px;font-style:italic;color:#6B2119">In English: your sign-in code is shown above. Valid for ${minutes} minutes. Do not share it.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html, tags: [{ name: "kind", value: "otp" }] };
}
