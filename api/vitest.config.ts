import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        // Tests must not depend on a developer's local .dev.vars (with the fake email mode on). Blank every optional secret and mode, so "fails closed without credentials" is tested for real.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations, OTP_PEPPER: "test-pepper", CONTACT_WHATSAPP: "60100000000",
            EMAIL_MODE: "", RESEND_API_KEY: "", EMAIL_FROM: "", BUILD_SECRET: ""
          }
        }
      })
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] }
  };
});
