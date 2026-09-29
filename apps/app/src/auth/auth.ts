import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import type { AuthConfig } from "./config";
import { AUTH_BASE_PATH, AUTH_COOKIE_PREFIX } from "./paths";
import * as schema from "./schema";

/**
 * LINE 會員一律用 placeholder email（ADR 0008）：LINE 的 email 未經驗證（ADR 0009），
 * 而且帳號連結關閉時，email 與既有會員相同會被 `account_not_linked` 拒絕登入。
 * `.invalid` 是保留 TLD，寄不出去。
 */
export const linePlaceholderEmail = (sub: string) => `line-${sub}@members.holdfast.invalid`;

/** LINE 的穩定身分是 `sub`；缺少或空白時丟錯，避免所有這類登入都變成同一個 `line-undefined@…` 會員。 */
function requireLineSub(profile: { sub?: unknown }): string {
  if (typeof profile.sub !== "string" || profile.sub.trim() === "") {
    throw new Error("LINE 回傳的身分缺少 sub，拒絕登入");
  }
  return profile.sub;
}

/**
 * 每個請求建立一次（同 catalog、admin service）。
 * 不以 email 自動合併帳號：同一人用 LINE 與 Google 登入是兩位會員（ADR 0009）。
 */
export function createAuth(config: AuthConfig, d1: D1Database) {
  const db = drizzle(d1, { schema });
  return betterAuth({
    baseURL: config.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    account: {
      accountLinking: { enabled: false },
      // provider 的 access / refresh / id token 以 AES-256-GCM 加密後才寫進 D1
      encryptOAuthTokens: true,
    },
    // 明確開啟並存在 D1（預設只在 production 開、存記憶體；Worker isolate 之間不共用）。
    // 來源 IP 只信 Cloudflare 設定的 cf-connecting-ip；預設的 x-forwarded-for 可由用戶端指定，會讓限流被繞過
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    socialProviders: {
      google: config.google,
      line: {
        ...config.line,
        mapProfileToUser: (profile) => ({ email: linePlaceholderEmail(requireLineSub(profile)) }),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
