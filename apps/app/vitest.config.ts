import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";
import { TEST_AUD, TEST_KID, TEST_TEAM_DOMAIN } from "./test/constants.ts";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );
      // 每次執行產生一組測試用 RSA 金鑰：公鑰 JWKS 給 App Worker 驗簽，私鑰只給測試簽發 JWT
      const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
      const meta = { alg: "RS256", use: "sig", kid: TEST_KID };
      const publicJwk = { ...(await exportJWK(publicKey)), ...meta };
      const privateJwk = { ...(await exportJWK(privateKey)), ...meta };
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        // 測試專用 binding：讓 setup 檔能把 drizzle-kit 產生的 migration 套到本機 D1
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
            ACCESS_AUD: TEST_AUD,
            ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
            TEST_ACCESS_PRIVATE_JWK: JSON.stringify(privateJwk),
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
