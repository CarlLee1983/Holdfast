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

/** 登出會讓 session 在 D1 失效；驗證登出的測試用這個獨立的 session，才不會讓共用 SESSION 的其他測試失效。 */
export const SIGN_OUT_SESSION = { id: "e2e-sign-out-session", token: "e2e-sign-out-session-token" } as const;

/**
 * 保留倒數測試專用的會員與 session。該測試會留下一筆有效保留，而每位會員同一時段最多一筆、同時最多 3 筆有效保留，
 * 共用 MEMBER 會與 main-flow 並行衝突，所以另立一位。
 */
export const COUNTDOWN_MEMBER = { id: "e2e-countdown-member", name: "E2E 倒數會員", email: "e2e-countdown@members.holdfast.invalid" } as const;
export const COUNTDOWN_SESSION = { id: "e2e-countdown-session", token: "e2e-countdown-session-token" } as const;

/**
 * 防重複送出測試專用的會員與 session。該測試會留下一筆有效保留，且要與其他 spec 並行，
 * 共用 MEMBER／COUNTDOWN_MEMBER 會撞到「同一時段一筆、同時最多 3 筆」的限制。
 */
export const DOUBLE_SUBMIT_MEMBER = { id: "e2e-double-submit-member", name: "E2E 防重送會員", email: "e2e-double-submit@members.holdfast.invalid" } as const;
export const DOUBLE_SUBMIT_SESSION = { id: "e2e-double-submit-session", token: "e2e-double-submit-session-token" } as const;

/** 無 JavaScript 測試專用的會員與 session：與防重複送出的其他測試各自獨立，/me 的保留列表才不會混入彼此的保留。 */
export const NO_JS_MEMBER = { id: "e2e-no-js-member", name: "E2E 無 JS 會員", email: "e2e-no-js@members.holdfast.invalid" } as const;
export const NO_JS_SESSION = { id: "e2e-no-js-session", token: "e2e-no-js-session-token" } as const;

/**
 * 確認頁「別人的保留」測試專用的會員：由它建立一筆保留，再用一般的 MEMBER 打開那個網址。
 * 不能借用 MEMBER 建立保留，否則會在 main-flow 的「目前沒有有效的保留」前留下殘留；也不借其他 spec 的專用會員，
 * 以免改變它們的保留額度。
 */
export const HOLD_OWNER_MEMBER = { id: "e2e-hold-owner-member", name: "E2E 保留擁有者", email: "e2e-hold-owner@members.holdfast.invalid" } as const;
export const HOLD_OWNER_SESSION = { id: "e2e-hold-owner-session", token: "e2e-hold-owner-session-token" } as const;
