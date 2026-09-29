---
status: accepted
---

# E2E 以直接寫入 session 取代社群登入，production 不含任何測試登入

E2E（#14）需要一個已登入的會員，但會員只能經 LINE／Google OAuth 登入（[ADR 0008](0008-better-auth-in-app-worker.md)）。E2E 不走 OAuth：測試開始前，由 E2E harness 直接在 E2E 專用的本機 D1 寫入一筆 `user` 與一筆 `session`，用固定的測試 `BETTER_AUTH_SECRET` 簽出 `better-auth.session_token` cookie 交給瀏覽器。App 與 Web Worker 都不新增任何測試登入的程式碼或設定——「production 不可用」靠的是這條路徑根本不存在，而不是某個旗標沒被打開；打錯旗標的後果是任何人能以任何會員身分登入，所以不接受只靠執行期設定守住。

依據：cookie 簽章格式是 `encodeURIComponent("<值>.<base64 HMAC-SHA256(值, secret)>")`——**已驗證**（`better-call@1.4.0` 的 `dist/crypto.mjs:26-31`，`signCookieValue`）；cookie 的值就是 `session.token` 欄位——**已驗證**（2026-09-29 實測：以測試 secret 簽出的 cookie 讓 `/me` 回 200 顯示會員頁，錯誤 secret 簽的被導向登入；E2E 的第一個斷言持續守住這一點）。

**Considered Options:**
- E2E 專用的 App entrypoint 加上 `createTestSession`，配 Web 端以 `import.meta.env.DEV` 守住的 `/test-login` 路由——走 Better Auth 自己的 API、不依賴內部格式，但 repo 裡多了兩段不能部署的程式碼，安全性落在建置設定正確。
- 假的 OIDC provider——要用 `genericOAuth` plugin 改動 production 的 auth 設定。

**Consequences:** E2E harness 綁定 Better Auth 的 session 資料表與 cookie 簽章格式；升級 Better Auth 若改了其中之一，E2E 會在登入後的第一個斷言失敗（大聲失敗，不會悄悄通過）。E2E 驗證的是 Astro、RPC 與 App Worker 的接線，不驗證 OAuth 本身——OAuth 由 App 測試以替身化的 provider 端點覆蓋。

**Falsified if:** `apps/app/src/auth/auth.ts` 為了測試新增 plugin 或登入方式，或 `apps/app/src/entrypoint.ts` 出現只給測試用的 RPC；或 Better Auth 升級改變了 `apps/app/src/auth/schema.ts` 的 session 資料表或 cookie 簽章格式——此時 `e2e/harness/serve.ts`（寫入 session）與 `e2e/harness/session-cookie.ts`（簽 cookie）要跟著改。
