import { z } from "zod";

// Better Auth 官方要求 secret 至少 32 字元
const required = z.string().min(1);

const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  // 瀏覽器看到的 Web Worker 公開 origin：OAuth 的 redirect_uri 由它組成
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,
  LINE_CHANNEL_ID: required,
  LINE_CHANNEL_SECRET: required,
});

/** 必須以 secret 設定的變數（其餘的 `BETTER_AUTH_URL` 是 wrangler.jsonc 的 vars）；部署前檢查共用這份清單。 */
export const AUTH_SECRET_NAMES = [
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "LINE_CHANNEL_ID",
  "LINE_CHANNEL_SECRET",
] as const satisfies readonly (keyof typeof authEnvSchema.shape)[];

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  baseURL: string;
  secret: string;
  google: OAuthClient;
  line: OAuthClient;
}

/**
 * 驗證並整理 Better Auth 需要的環境設定。缺少或無效時一次列出所有變數名稱後丟出錯誤
 * （只寫名稱與原因，不含值，避免 secret 進 log）。App Worker 在載入時呼叫它，所以設定不全時整個 Worker 起不來。
 */
export function parseAuthConfig(env: object): AuthConfig {
  const parsed = authEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}（${issue.message}）`,
    );
    throw new Error(`會員登入的環境設定不完整或無效：${problems.join("、")}`);
  }
  const values = parsed.data;
  return {
    baseURL: values.BETTER_AUTH_URL,
    secret: values.BETTER_AUTH_SECRET,
    google: { clientId: values.GOOGLE_CLIENT_ID, clientSecret: values.GOOGLE_CLIENT_SECRET },
    line: { clientId: values.LINE_CHANNEL_ID, clientSecret: values.LINE_CHANNEL_SECRET },
  };
}
