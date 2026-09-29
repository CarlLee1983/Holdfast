// 只給 `bun run auth:generate` 使用的設定檔，不進 Worker bundle、不被 src/ 引用。
// Better Auth CLI 需要一個能在 Node 載入的 `auth` 匯出，用它推導 schema；
// CLI 版本（package.json 的 auth:generate）與 better-auth 依賴都釘死 1.7.6，升級時兩處一起改。
// 凡是會影響 schema 的選項（plugins、additionalFields）必須與 src/auth/auth.ts 一致。
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

export const auth = betterAuth({
  baseURL: "http://localhost:4321",
  secret: "cli-only-secret-never-used-at-runtime-0000",
  database: drizzleAdapter(drizzle({} as D1Database), { provider: "sqlite" }),
});
