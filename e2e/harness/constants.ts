/**
 * E2E 的固定設定。受測伺服器（serve.ts）與測試（Playwright worker）是不同行程，
 * 兩邊要對同一組值達成一致，所以用常數而不是每次隨機產生。
 */

/** 不用 Astro dev 的 4321：避免和開發中的伺服器（或其他專案）搶埠。 */
export const PORT = 8790;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * 只給 E2E 專用、每次重建的本機 D1 使用的 Better Auth secret（不是任何環境的真 secret）。
 * E2E 以它簽 session cookie（ADR 0013）；production 與開發者的 `.dev.vars` 都不會用到它。
 */
export const AUTH_SECRET = "holdfast-e2e-only-secret-not-for-any-real-env";

/** 測試會員與它的 session（直接寫入 E2E 的 D1，不經 OAuth）。 */
export const MEMBER = { id: "e2e-member", name: "E2E 會員", email: "e2e-member@members.holdfast.invalid" } as const;
export const SESSION = { id: "e2e-session", token: "e2e-session-token" } as const;
