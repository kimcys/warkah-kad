const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
export function randomSuffix(n = 4): string {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((b) => SLUG_CHARS[b % SLUG_CHARS.length]).join("");
}
