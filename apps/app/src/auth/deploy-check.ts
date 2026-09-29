/** 部署前檢查用（`scripts/check-auth-deploy.ts`），不被 Worker 引用。 */
import { z } from "zod";
import { AUTH_SECRET_NAMES } from "./config";

/**
 * 各環境 Web 的公開 origin（README「部署」的網址表）。`BETTER_AUTH_URL` 必須與它完全相等：
 * OAuth 的 redirect_uri 由它組成，填錯（例如貼到別的環境、多一個結尾斜線）登入只會在 provider 端失敗。
 */
export const WEB_ORIGINS = {
  preview: "https://holdfast-preview.gravito.dev",
  production: "https://holdfast.gravito.dev",
} as const;

export type DeployEnv = keyof typeof WEB_ORIGINS;

/**
 * 回傳部署後會讓會員登入不可用的問題。secret 的值是 write-only，讀不到，所以只能檢查名稱是否存在；
 * `BETTER_AUTH_URL` 是純文字 var，可以檢查值。
 */
export function checkAuthDeploy(input: {
  deployEnv: DeployEnv;
  authUrl: string | undefined;
  secretNames: readonly string[];
}): string[] {
  const problems: string[] = [];
  const expected = WEB_ORIGINS[input.deployEnv];
  if (!input.authUrl) problems.push("缺少 BETTER_AUTH_URL");
  else if (input.authUrl !== expected) {
    problems.push(`BETTER_AUTH_URL 應為 ${expected}，目前是 ${input.authUrl}`);
  }
  for (const name of AUTH_SECRET_NAMES) {
    if (!input.secretNames.includes(name)) problems.push(`缺少 ${name}`);
  }
  return problems;
}

const secretListSchema = z.array(z.object({ name: z.string() }));

/** 解析 `wrangler secret list --format json` 的輸出；格式不符就丟錯，不能當作「沒有任何 secret」。 */
export function parseSecretList(output: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch {
    throw new Error("wrangler secret list 的輸出不是 JSON");
  }
  const parsed = secretListSchema.safeParse(json);
  if (!parsed.success) throw new Error("wrangler secret list 的輸出格式不符預期（應為 [{ name }]）");
  return parsed.data.map((secret) => secret.name);
}
