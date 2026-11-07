declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    /** The site's own static files (landing page and builder: the Vite build). Used for every path the Worker answers first but does not own. */
    ASSETS: Fetcher;
    /** Hostname that serves published cards at /<slug>/. Unset = no card host. */
    CARD_HOST?: string;
    PUBLIC_ORIGIN: string;
    /** WhatsApp number (digits, with country code) customers contact to activate their card while online payment is off. */
    CONTACT_WHATSAPP?: string;
    /** Secret mixed into one-time code hashes. Required. */
    OTP_PEPPER: string;
    /** Shared secret of the build server (it sends it as a Bearer token to /api/build/*). Without it those routes answer 503. */
    BUILD_SECRET?: string;
    /** Resend credentials. Both are secrets; without them email fails closed unless EMAIL_MODE is "fake". */
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    /** Optional: where replies to our emails go (a monitored inbox). */
    EMAIL_REPLY_TO?: string;
    /** "fake" prints emails to the console. Local development only; never set on a deployed Worker. */
    EMAIL_MODE?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
