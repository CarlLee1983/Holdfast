import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // 測試專用 binding：讓 setup 檔能把 drizzle-kit 產生的 migration 套到本機 D1
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
