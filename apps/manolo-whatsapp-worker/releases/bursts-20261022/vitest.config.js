import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
export default defineConfig({ plugins: [cloudflareTest(async () => ({
  wrangler: { configPath: "./wrangler.jsonc" }, miniflare: {
    bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations"),
      META_APP_SECRET: "test-meta-secret", META_ACCESS_TOKEN: "test-meta-token", GROQ_API_KEY: "test-groq-key",
      VPS_BRIDGE_HMAC_SECRET: "test-hmac-key-at-least-32-characters", VPS_BRIDGE_ENABLED: "false",
      VPS_PLATFORM_SHADOW_ENABLED: "false", WHATSAPP_BURST_ENABLED: "false" }
  } }))], test: { include: ["test/**/*.test.js"], setupFiles: ["./test/apply-migrations.js"] } });
