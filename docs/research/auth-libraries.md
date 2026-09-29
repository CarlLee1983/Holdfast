# 會員認證套件評估（Cloudflare Workers + D1 + LINE / Google）

查證日期：2026-09-29。
標記規則：**已驗證（官方文件/原始碼）** 表示官方文件原文、原始碼或官方 registry / API 直接呈現；**推論** 表示由已驗證事實推導、來源未直接寫明，寫進 ADR 前應實測。本文沒有做任何執行期實驗。

前提（已定案）：Web Worker = Astro SSR（Cloudflare adapter），App Worker = Hono，兩者以 Service Binding RPC 相連（[ADR 0005](../adr/0005-web-app-split-via-rpc.md)）；資料庫 D1、ORM Drizzle；會員只能用 LINE Login 與 Google 登入，不存密碼；管理者走 Cloudflare Access，不在本文範圍（[ADR 0007](../adr/0007-admin-behind-cloudflare-access.md)）。

---

## 0. 總表

| 項目 | Better Auth | Auth.js（@auth/core + auth-astro） | Arctic + Oslo | OpenAuth |
| --- | --- | --- | --- | --- |
| 最新版 / 日期 | 1.7.6 / 2026-09-24 | @auth/core 0.41.3 / 2026-07-20；auth-astro 4.2.0 / 2024-12-03 | 3.7.0 / 2025-05-21，**已棄用** | 0.4.3 / 2025-03-04 |
| 專案狀態 | 活躍 | 只修安全性與緊急問題，官方建議新專案改用 Better Auth | 2026-07 作者宣布棄用 | 近一年無 push |
| 授權 | MIT | ISC（auth-astro MIT） | MIT | MIT（GitHub） |
| nodejs_compat | 需要 AsyncLocalStorage；相容日期 ≥ 2026-08-04 預設開啟 | 推論不需要 | 推論不需要 | — |
| D1 | 直接傳 D1 binding，或 Drizzle adapter（sqlite） | `@auth/d1-adapter` 或 `@auth/drizzle-adapter` | 自己寫 session 層 | 自己的 storage 介面 |
| 需要互動式交易 | 預設不需要（Drizzle `transaction` 預設 false）；SCIM plugin 需要 | 否 | — | — |
| LINE | 內建 `line` provider | 內建 `LINE` provider（OIDC） | 內建 | — |
| Google | 內建 | 內建 | 內建 | — |
| Session | DB session（預設）＋可選 cookie cache／stateless | 有 adapter 時 DB session，否則 JWT | 自己實作 | 簽發 token（OAuth server 模型） |

資料來源見各節。版本、日期、授權、棄用訊息取自 npm registry（`https://registry.npmjs.org/<pkg>`）與 GitHub API，查詢時間 2026-09-29。**已驗證（官方 registry/原始碼）**

---

## 1. Better Auth

**(1) Workers 相容性。** 官方文件：「Better Auth uses AsyncLocalStorage for async context tracking. To enable this in Cloudflare Workers, add the `nodejs_compat` flag」，Hono 整合頁也有同樣要求。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/installation.mdx （cloudflare-workers 分頁）
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/integrations/hono.mdx

Cloudflare 自 compatibility date `2026-08-04` 起預設開啟 `nodejs_compat` 與 `nodejs_compat_v2`；新專案只要相容日期設在這之後就不必再手動加旗標。**已驗證（官方文件）**
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/

**(2) D1 與交易。** 內建 Kysely adapter 會偵測具有 `batch`／`exec`／`prepare` 的物件，視為 D1 並改用自帶的 `D1SqliteDialect`；文件範例就是 `database: env.DB`。這個 dialect 的 `beginTransaction()` 直接丟出「D1 does not support interactive transactions. Use the D1 batch() API instead.」**已驗證（原始碼、官方文件）**
- https://github.com/better-auth/better-auth/blob/main/packages/kysely-adapter/src/dialect.ts
- https://github.com/better-auth/better-auth/blob/main/packages/kysely-adapter/src/d1-sqlite-dialect.ts
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/database.mdx （「Example: Cloudflare D1」）

Drizzle adapter（`provider: "sqlite"`）的 `transaction` 選項預設為 `false`，註解寫「If the database doesn't support transactions, set this to `false` and operations will be executed sequentially」。原始碼中無條件呼叫 `db.transaction()` 的路徑只在 `config.provider === "mysql"` 分支。**已驗證（原始碼）**
- https://github.com/better-auth/better-auth/blob/main/packages/drizzle-adapter/src/drizzle-adapter.ts

例外：SCIM plugin 文件寫明「Cloudflare D1 does not support the interactive transactions required by the SCIM plugin」。本專案不需要 SCIM。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/plugins/scim/index.mdx

`transaction: false` 表示建立 user＋account＋session 這幾筆寫入是逐句執行、不具原子性，中途失敗可能留下孤兒列。**推論**（由上述選項語意推得）。

用 Drizzle adapter 時，官方的程式化遷移 `getMigrations` 不適用（「does not work with Prisma or Drizzle ORM adapters — use CLI migrations」），schema 改由 Better Auth CLI 產生後交給 drizzle-kit 管理。**已驗證（官方文件）** — 同上 database.mdx

**(3) LINE。** 內建 `socialProviders.line`，預設 scope `openid profile email`，支援 PKCE（`codeVerifier`），以 LINE 官方 `https://api.line.me/oauth2/v2.1/verify` 端點驗證 ID token；因 LINE 不提供 email 驗證狀態，一律設 `emailVerified: false`。**已驗證（原始碼、官方文件）**
- https://github.com/better-auth/better-auth/blob/main/packages/core/src/social-providers/line.ts
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/line.mdx

**email 是硬需求，LINE 會缺。** Better Auth「currently requires an email address on every user record」，缺 email 時 OAuth 回呼導向 `error=email_not_found`（`callback.ts` 裡 `if (!userInfo.email)` 分支）；文件建議用 `mapProfileToUser` 以供應商的穩定 ID 造一個 placeholder email。**已驗證（官方文件、原始碼）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/oauth.mdx （「Create a placeholder email with `mapProfileToUser`」）
- https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/api/routes/callback.ts

LINE 端：取得 email 要先在 LINE Developers Console 申請 email 權限，而且使用者可以不同意部分權限。**已驗證（官方文件）**
- https://developers.line.biz/en/docs/line-login/integrate-line-login/

合起來：LINE 使用者沒給 email 時，不設 placeholder 就無法登入。**推論**

**帳號連結。** 預設只有在 email 相同，且供應商標示 email 已驗證或列在 `trustedProviders` 時才自動連結；`disableImplicitLinking: true` 可關閉。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/users-accounts.mdx

LINE 的 `emailVerified` 永遠是 false，所以同一個人先用 Google、再用 LINE 登入，預設會變成兩位會員，除非把 `line` 放進 `trustedProviders`（等於信任一個未驗證的 email）或提供登入後手動連結。**推論**

**(4) Google。** 內建 `socialProviders.google`。**已驗證（原始碼）** — https://github.com/better-auth/better-auth/tree/main/packages/core/src/social-providers

**(5) Session 模型。** 預設把 session 存在資料庫；可加 cookie cache（短效、簽章 cookie，減少讀 DB）、secondary storage（例如 KV），或完全 stateless。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/session-management.mdx

Astro 整合方式：把 `auth.handler` 掛在 `pages/api/auth/[...all].ts`，middleware 以 `auth.api.getSession({ headers })` 把 user/session 放進 `Astro.locals`。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/integrations/astro.mdx

`auth.handler` 吃標準 `Request`、回 `Response`，所以可以放在任何一個 Worker，由另一個 Worker 轉送。**推論**（由上述 API 形狀推得）

**(6) 維護狀態。** v1.7.6 發布於 2026-09-24，repo 最後 push 在 2026-09-28，未封存。自 2025-09-22 起 Auth.js 也由 Better Auth 團隊接手。**已驗證（GitHub API、官方部落格）**
- https://github.com/better-auth/better-auth/releases
- https://better-auth.com/blog/authjs-joins-better-auth

遙測預設關閉（「optional, transparent, and disabled by default」）。**已驗證（官方文件）**
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/reference/telemetry.mdx

**(7) 授權。** MIT。**已驗證（npm registry、GitHub）**

---

## 2. Auth.js（@auth/core、auth-astro、@auth/d1-adapter / @auth/drizzle-adapter）

**(1) Workers 相容性。** `@auth/core` 的執行期依賴只有 `jose`、`oauth4webapi`、`@panva/hkdf`、`preact`、`preact-render-to-string`，都是 Web 標準 API 的實作。**已驗證（npm registry）**；因此不需要 `nodejs_compat`，屬 **推論**。

**(2) D1 與交易。** 有官方 `@auth/d1-adapter`（直接吃 D1 binding）與 `@auth/drizzle-adapter`（含 `sqlite.ts`）。兩者原始碼中都找不到 `transaction` 呼叫。**已驗證（原始碼）**
- https://github.com/nextauthjs/next-auth/tree/main/packages/adapter-d1/src
- https://github.com/nextauthjs/next-auth/blob/main/packages/adapter-drizzle/src/lib/sqlite.ts

**(3) LINE。** 內建 `LINE` provider，`type: "oidc"`、`issuer: "https://access.line.me"`、`checks: ["state"]`（沒有開 PKCE）；文件提醒要取得 email 須先申請 email 權限。**已驗證（原始碼）**
- https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/line.ts

LINE 確實提供 OIDC discovery：`https://access.line.me/.well-known/openid-configuration` 回 200，`code_challenge_methods_supported: ["S256"]`、`id_token_signing_alg_values_supported: ["ES256"]`。**已驗證（2026-09-29 直接請求該端點）**

**(4) Google。** 內建。**已驗證（原始碼）** — https://github.com/nextauthjs/next-auth/tree/main/packages/core/src/providers

**(5) Session 模型。** 「This is the default session strategy for Auth.js unless a database provider is configured」——預設 JWT，有 adapter 時改為資料庫 session。**已驗證（官方文件）**
- https://authjs.dev/concepts/session-strategies

**(6) 維護狀態。** next-auth README：「Auth js is now part of Better Auth … We recommend new projects to start with Better Auth unless there are some very specific feature gaps (most notably stateless session management without a database).」公告寫明會持續處理安全性修補與緊急問題，但不規劃重大新功能。`@auth/core` 0.41.3 發布於 2026-07-20，仍在 0.x。**已驗證（原始碼 README、官方部落格、npm registry）**
- https://github.com/nextauthjs/next-auth
- https://better-auth.com/blog/authjs-joins-better-auth

`auth-astro` 是社群維護（repo 描述「Community maintained Astro integration of @auth/core」），最後發布 4.2.0 在 2024-12-03，peerDependency 鎖在 `@auth/core ^0.37.3`（0.x 的 caret 只允許 0.37.x），與目前 0.41.3 不相容；Astro 目前是 7.3.5。**已驗證（npm registry、GitHub API）**
- https://github.com/nowaythatworked/auth-astro

要在 Astro 7 上用 Auth.js，必須放棄 auth-astro、自己把 `@auth/core` 的 `Auth()` 接到 API route，或用 `@hono/auth-js`（1.1.1，2026-02-14）掛在 Hono。**推論**

**(7) 授權。** `@auth/*` 為 ISC，auth-astro 為 MIT（npm）。**已驗證（npm registry）**

---

## 3. Arctic（+ Oslo）

**已棄用，不列入候選。** Arctic README 開頭：「Arctic was deprecated on July 2026」；作者 2026-07-29 的公告寫「I haven't touched the project in nearly a year」，並認為「The OAuth 2.0 protocol isn't an ideal layer to abstract into a library」。Oslo 除 `@oslojs/encoding` 外全部停止維護。npm 上 `arctic`、`@oslojs/oauth2`、`@oslojs/crypto` 均標示「Package no longer supported」。**已驗證（原始碼 README、作者公告、npm registry）**
- https://github.com/pilcrowonpaper/arctic
- https://pilcrowonpaper.com/blog/18

即使在棄用前，Arctic 也只負責 OAuth 授權碼交換，session、cookie、帳號資料表都要自己寫，與「不自己手刻 session」的要求衝突。Lucia v3 早在 2025 年已棄用（npm：「This package has been deprecated. Please see https://lucia-auth.com/lucia-v3/migrate」）。**已驗證（npm registry）**

---

## 4. 其他候選

**OpenAuth（`@openauthjs/openauth`）。** 定位是自架的 OAuth 授權伺服器（另一個服務簽發 token），不是嵌入式 session 套件。最新 0.4.3 發布於 2025-03-04，repo（現為 `anomalyco/openauth`）最後 push 在 2025-07-18。**已驗證（npm registry、GitHub API）** 對單一商家、兩個登入方式的需求來說，多一個授權伺服器屬過度設計，而且一年多沒有動靜。**推論**
- https://github.com/anomalyco/openauth

**better-auth-cloudflare（社群）。** 0.3.1，2026-07-23，MIT，把 D1／KV／geolocation 包成 Better Auth plugin。**已驗證（npm registry）** 是第三方包裝、非官方，核心能力 Better Auth 已內建。**推論**
- https://github.com/zpg6/better-auth-cloudflare

---

## 5. 對設計的含意（全部為 **推論**）

**建議採用 Better Auth，實體放在 App Worker。** Auth.js 已進入只修安全性的狀態，官方自己叫新專案改用 Better Auth，Astro 整合套件也停在不相容的舊版；Arctic、Lucia、Oslo 都已棄用；OpenAuth 模型不合且停滯。剩下唯一活躍、內建 LINE 與 Google、可接 D1／Drizzle、不依賴互動式交易的選項就是 Better Auth。

**為什麼放 App Worker。** [ADR 0005](../adr/0005-web-app-split-via-rpc.md) 規定會員等應用邏輯全在 App Worker，而會員資料表（`user`／`account`／`session`）和保留、訂位共用同一個 D1、同一套 Drizzle schema；讓 Web Worker 也綁 D1 並直接寫會員表，等於開了第二個寫入入口。具體做法：

1. App Worker 建立 `betterAuth({ database: drizzleAdapter(db, { provider: "sqlite" }), socialProviders: { line, google } })`，`transaction` 保持預設 false。
2. Web Worker 的 `pages/api/auth/[...all].ts` 不處理認證，只把 `Request` 原樣轉給 App Worker——可以用 Service Binding 的 `fetch()`，或定義一個 RPC 方法收 `Request`、回 `Response`；兩者 Cloudflare 都支援（已驗證：https://developers.cloudflare.com/workers/runtime-apis/rpc/ 列出 Request/Response 為可傳型別；https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/ 列出 HTTP 介面）。`baseURL` 要設成 Web Worker 的公開網址，OAuth redirect URI 也登記在這個網址，Set-Cookie 經 Web Worker 原樣回給瀏覽器。
3. Astro middleware 呼叫一個 RPC（例如 `getSession(headers)`），App Worker 內部執行 `auth.api.getSession({ headers })`，結果放進 `Astro.locals`。
4. 領域 RPC（保留、確認、取消）建議傳入原始 cookie 由 App Worker 自行解析 session，而不是信任 Web Worker 傳來的 `memberId`；Service Binding 不對外公開，後者也可行，但前者讓身分判定只存在一處。
5. 開啟 cookie cache 可以省下每次頁面請求讀 D1 的成本，代價是撤銷 session 最多延遲 `maxAge` 才生效。

**要進 ADR 或實測的開放問題：**

- **LINE 沒有 email。** 必須用 `mapProfileToUser` 以 LINE `sub` 產生 placeholder email，否則未授權 email 的 LINE 使用者無法登入。要不要申請 LINE email 權限、placeholder 的格式，都是待定決策。
- **同一人兩個帳號。** LINE 的 email 永遠被視為未驗證，Google 與 LINE 預設不會自動合併。[CONTEXT.md](../../CONTEXT.md) 規定「同一位會員在同一個時段最多持有一筆有效的保留或訂位」，一人兩個會員就能繞過這條規則。三種處理方式：接受這個風險、登入後提供手動連結、把 `line` 列入 `trustedProviders`（有冒用風險）。這需要一份 ADR。
- **非原子的註冊寫入。** `transaction: false` 下 user／account／session 分句寫入，要實測中途失敗會留下什麼，以及下次登入能否自我修復。
- **RPC 轉送 OAuth 回呼。** 經 Service Binding 轉送時，redirect、Set-Cookie、`Host`／`X-Forwarded-*` 標頭是否被 Better Auth 正確辨識，屬 [ADR 0001](../adr/0001-experiment-wins-conflicts.md) 下的實測對象。
- **相容日期。** 兩個 Worker 的 `compatibility_date` 設在 2026-08-04 以後，就不必手動加 `nodejs_compat`；早於這個日期則必須加上。

**Falsified if**（供 ADR 引用）：Better Auth 的 Drizzle adapter 在 `provider: "sqlite"` 下改成無條件呼叫 `db.transaction()`（查 `packages/drizzle-adapter/src/drizzle-adapter.ts`），或 LINE provider 從 `packages/core/src/social-providers/line.ts` 移除，或專案狀態轉為只做維護。
