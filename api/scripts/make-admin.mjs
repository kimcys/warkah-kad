#!/usr/bin/env node
// Gives an email address the admin role, so that account can use /app/admin to activate packages after a manual payment.
// If the address has never signed in, the account is created now: signing in with it later (an emailed code) gives you the admin account.
//
//   npm run make-admin -- you@example.com            local database
//   npm run make-admin -- you@example.com --remote   the real staging database
//   npm run make-admin -- you@example.com --revoke   back to an ordinary account
//
// Admin is deliberately not something the app itself can grant: this command is the only way.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith("--")) ?? "").trim().toLowerCase();
const remote = args.includes("--remote");
const revoke = args.includes("--revoke");

// Letters, digits and . _ % + - only before the @: nothing that could change the meaning of the SQL below.
if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/.test(email)) {
  console.error("Usage: npm run make-admin -- you@example.com [--remote] [--revoke]   (a plain email address)");
  process.exit(2);
}

const now = Date.now();
const role = revoke ? "customer" : "admin";
const sql = revoke
  ? `UPDATE users SET role = 'customer' WHERE email = '${email}';`
  : `INSERT INTO users (id, email, role, created_at) VALUES ('${randomUUID()}', '${email}', 'admin', ${now}) ON CONFLICT(email) DO UPDATE SET role = 'admin';`;

const dir = mkdtempSync(join(tmpdir(), "make-admin-"));
try {
  const file = join(dir, "q.sql");
  writeFileSync(file, `${sql}\n`);
  execFileSync("npx", ["wrangler", "d1", "execute", "warkah-kad", remote ? "--remote" : "--local", "--file", file], { stdio: ["ignore", "pipe", "pipe"] });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${email} is now ${role === "admin" ? "an admin" : "an ordinary account"} (${remote ? "remote" : "local"} database).`);
if (!revoke) console.log("Sign in with that email in the app, then open /app/admin.");
