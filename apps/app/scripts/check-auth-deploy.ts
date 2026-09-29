// 部署前檢查：會員登入的設定不全或 BETTER_AUTH_URL 填錯時，部署出去的登入是壞的，所以在 migration 之前先擋下。
//   - BETTER_AUTH_URL 讀 wrangler.jsonc 該環境的 vars，並確認等於該環境 Web 的自訂網域
//   - secrets 讀 `wrangler secret list --env <env>`（值是 write-only，只能檢查名稱存在；需要 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）
// 用法：bun scripts/check-auth-deploy.ts <preview|production>
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { checkAuthDeploy, parseSecretList, WEB_ORIGINS, type DeployEnv } from "../src/auth/deploy-check";

const arg = process.argv[2];
if (arg !== "preview" && arg !== "production") {
  console.error("用法：bun scripts/check-auth-deploy.ts <preview|production>");
  process.exit(2);
}
const deployEnv: DeployEnv = arg;

const appDir = path.resolve(import.meta.dirname, "..");
const parsed = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync(path.join(appDir, "wrangler.jsonc"), "utf8"),
);
if (parsed.error) throw new Error("無法解析 wrangler.jsonc");
const authUrl: unknown = parsed.config?.env?.[deployEnv]?.vars?.BETTER_AUTH_URL;

const listed = Bun.spawnSync(["bunx", "wrangler", "secret", "list", "--env", deployEnv, "--format", "json"], {
  cwd: appDir,
  stderr: "pipe",
});
if (listed.exitCode !== 0) {
  console.error(`::error::無法列出 ${deployEnv} 的 secrets（Worker 尚未建立或 API token 權限不足？）`);
  console.error(listed.stderr.toString());
  process.exit(1);
}
let secretNames: string[];
try {
  secretNames = parseSecretList(listed.stdout.toString());
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const problems = checkAuthDeploy({
  deployEnv,
  authUrl: typeof authUrl === "string" ? authUrl : undefined,
  secretNames,
});
if (problems.length > 0) {
  console.error(
    `::error::${deployEnv} 的會員登入設定有問題，已中止（尚未套用 migration）：${problems.join("；")}。` +
      `BETTER_AUTH_URL 填在 apps/app/wrangler.jsonc（${WEB_ORIGINS[deployEnv]}），` +
      `secret 用 \`wrangler secret put <名稱> --env ${deployEnv}\` 設定，見 README「會員登入」。`,
  );
  process.exit(1);
}
console.log(`${deployEnv} 的會員登入設定齊全。`);
