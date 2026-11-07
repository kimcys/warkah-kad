// Sending email. Resend's API is documented at https://resend.com/docs/api-reference/emails/send-email and its errors at
// https://resend.com/docs/api-reference/errors. This module is verified against those docs and NOT yet against the live service.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Resend tags: name and value are ASCII letters, digits, underscores or dashes. Used to find mail in the Resend dashboard. */
  tags?: { name: string; value: string }[];
}

export interface SendOptions {
  /** A retry with the same key never sends a second email (Resend remembers keys for 24 hours). Defaults to a fresh random key. */
  idempotencyKey?: string;
}

export interface SendResult {
  /** The provider's id for the message, for finding it in their dashboard. null when there is none (the console sender). */
  id: string | null;
}

export interface EmailSender {
  send(message: EmailMessage, options?: SendOptions): Promise<SendResult>;
}

/** A refusal or failure from the email provider. `retryable` says whether trying again could help. */
export class EmailError extends Error {
  constructor(public code: string, public status: number, public retryable: boolean) {
    super(code);
  }
}

/**
 * Turns a Resend error response into an EmailError. Retryable: a per-second rate limit, a concurrent request with the same key,
 * a locked resource, and any 5xx. Everything else is permanent: a bad or restricted key, an unverified domain, testing mode
 * (you may only send to your own address), invalid fields, and daily or monthly quota (retrying within the hour cannot help).
 */
export function classifyResendError(status: number, body: unknown): EmailError {
  const name = typeof (body as { name?: unknown })?.name === "string" ? (body as { name: string }).name : "";
  const code = name || `http_${status}`;
  if (status === 429) return new EmailError(code, status, name !== "daily_quota_exceeded" && name !== "monthly_quota_exceeded");
  if (status === 409) return new EmailError(code, status, name === "concurrent_idempotent_requests" || name === "resource_locked");
  return new EmailError(code, status, status >= 500);
}

export interface ResendOptions {
  apiKey: string;
  /** `address@domain` or `Name <address@domain>`. */
  from: string;
  replyTo?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Retries after the first attempt (so 2 means up to 3 attempts). */
  retries?: number;
  backoffMs?: number;
  baseUrl?: string;
}

export class ResendSender implements EmailSender {
  private o: Required<Pick<ResendOptions, "timeoutMs" | "retries" | "backoffMs" | "baseUrl">> & ResendOptions;

  constructor(options: ResendOptions) {
    this.o = { timeoutMs: 8000, retries: 2, backoffMs: 300, baseUrl: "https://api.resend.com", ...options };
  }

  private async attempt(m: EmailMessage, key: string): Promise<SendResult> {
    const f = this.o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    let res: Response;
    try {
      res = await f(`${this.o.baseUrl}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.o.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          from: this.o.from,
          to: [m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(this.o.replyTo ? { reply_to: this.o.replyTo } : {}),
          ...(m.tags?.length ? { tags: m.tags } : {})
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs)
      });
    } catch {
      throw new EmailError("network_error", 0, true); // no answer, or no answer in time
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return { id: typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : null };
    const err = classifyResendError(res.status, body);
    // Server logs only: what to fix (a restricted key, an unverified domain). Never the message body, a code, or the API key.
    console.error(`[email] resend refused: status=${res.status} name=${err.code} retryable=${err.retryable} message=${JSON.stringify((body as { message?: unknown })?.message ?? "")}`);
    throw err;
  }

  async send(m: EmailMessage, options: SendOptions = {}): Promise<SendResult> {
    const key = options.idempotencyKey ?? crypto.randomUUID();
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(m, key); // every retry reuses the key, so a slow success can never become two emails
      } catch (err) {
        if (!(err instanceof EmailError) || !err.retryable || attempt >= this.o.retries) throw err;
        await sleep(this.o.backoffMs * (attempt + 1));
      }
    }
  }
}

/** Local development only: prints the email so you can copy the code. */
export class ConsoleSender implements EmailSender {
  async send(m: EmailMessage): Promise<SendResult> {
    console.log(`[fake email] to=${m.to} subject=${m.subject}\n${m.text}`);
    return { id: null };
  }
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** `a@b.co` or `Name <a@b.co>`. Rejects anything that could smuggle in another header. */
export function parseSender(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || /[\r\n]/.test(v)) return null;
  if (ADDRESS.test(v)) return v;
  const named = /^([^<>"\r\n]{1,100}) <([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)>$/.exec(v);
  return named ? v : null;
}

/** Fails closed: a deployed Worker with no valid Resend credentials must not pretend to send mail. */
export function senderFromEnv(env: Cloudflare.Env): EmailSender {
  if (env.RESEND_API_KEY || env.EMAIL_FROM) {
    const from = parseSender(env.EMAIL_FROM);
    if (env.RESEND_API_KEY && from) {
      const replyTo = parseSender(env.EMAIL_REPLY_TO) ?? undefined;
      return new ResendSender({ apiKey: env.RESEND_API_KEY, from, replyTo });
    }
    console.error("[email] RESEND_API_KEY and a valid EMAIL_FROM (address or 'Name <address>') are both required");
  }
  if (env.EMAIL_MODE === "fake") return new ConsoleSender();
  throw new Error("email_not_configured");
}
