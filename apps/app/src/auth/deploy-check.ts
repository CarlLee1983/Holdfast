/** 部署前檢查用（`scripts/check-auth-deploy.ts`），不被 Worker 引用。 */
import { AUTH_SECRET_NAMES } from "./config";

/** 回傳部署後會讓 App Worker 載入失敗的缺漏設定名稱（`BETTER_AUTH_URL` 與各個 secret）。 */
export function findMissingAuthSettings(input: {
  authUrl: string | undefined;
  secretNames: readonly string[];
}): string[] {
  const missing: string[] = [];
  if (!input.authUrl) missing.push("BETTER_AUTH_URL");
  for (const name of AUTH_SECRET_NAMES) {
    if (!input.secretNames.includes(name)) missing.push(name);
  }
  return missing;
}
