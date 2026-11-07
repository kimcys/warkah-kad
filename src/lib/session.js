// Small helpers shared by the screens.

/** Today's date in Malaysia (UTC+8) as YYYY-MM-DD. */
export const todayMyt = (now = Date.now()) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);

/** True when a request failed because the customer is not signed in (any more). */
export const isSignedOut = (err) => err?.status === 401;
