import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import type { AuthConfig } from "./config";
import * as schema from "./schema";

/**
 * LINE 會員一律用 placeholder email（ADR 0008）：LINE 的 email 未經驗證（ADR 0009），
 * 而且帳號連結關閉時，email 與既有會員相同會被 `account_not_linked` 拒絕登入。
 * `.invalid` 是保留 TLD，寄不出去。
 */
export const linePlaceholderEmail = (sub: string) => `line-${sub}@members.holdfast.invalid`;

/**
 * 每個請求建立一次（同 catalog、admin service）。
 * 不以 email 自動合併帳號：同一人用 LINE 與 Google 登入是兩位會員（ADR 0009）。
 */
export function createAuth(config: AuthConfig, d1: D1Database) {
  const db = drizzle(d1, { schema });
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      google: config.google,
      line: {
        ...config.line,
        mapProfileToUser: (profile) => ({ email: linePlaceholderEmail(profile.sub) }),
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
