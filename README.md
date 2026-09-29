# Holdfast

部署在 Cloudflare 上的單一商家訂位服務：會員先保留某個資源時段的名額，確認後成立訂位，逾時未確認的保留自動釋放。詞彙定義見 [CONTEXT.md](CONTEXT.md)。

MVP 的架構與技術選型已定案並記錄在 [docs/adr/](docs/adr/)，程式碼從公開時段列表的骨架開始（見下方「開發」）。

## 架構

```
瀏覽器
   │
   ▼
Cloudflare DNS / HTTPS / WAF ── /admin 前置 Cloudflare Access（ADR 0007）
   │
   ▼
Web Worker（Astro + Workers Static Assets）
  公開網頁、會員頁面、管理後台
   │ Service Binding RPC（ADR 0005）
   ▼
App Worker（WorkerEntrypoint RPC + Application + Domain）
  會員、資源與時段、保留與訂位
   ├── D1：正式業務資料，防超賣見 ADR 0004
   └── Cron：每分鐘釋放過期保留
```

每個選擇的理由都在 [docs/adr/](docs/adr/)；平台行為的查證紀錄在 [docs/research/](docs/research/)。

## 開發

需要 [Bun](https://bun.sh)（僅作套件管理與腳本執行器，執行環境一律是 workerd）。

```
apps/app   App Worker：WorkerEntrypoint RPC（沒有 HTTP 路由，不用 HTTP 框架）、領域邏輯、D1 + Drizzle（依功能分資料夾，例如 catalog）
apps/web   Web Worker：Astro + @astrojs/cloudflare，只經 Service Binding RPC 取資料，沒有 D1 binding
e2e        Playwright：以建置產物跑兩個 Worker，瀏覽器走過會員主流程
```

```sh
bun install
bun run typecheck      # 兩個 Worker 的型別檢查（先跑 wrangler types）
bun run test           # Vitest + @cloudflare/vitest-pool-workers，真的本機 D1，經 RPC 呼叫
bun run db:migrate     # 把 apps/app/migrations 套到本機 D1
bun run db:seed        # 寫入 2 個資源與數個時段（可重複執行，會先清空）
bun run admin:dev-token # 產生本機 /admin 用的測試金鑰與 JWT（見「管理後台」）
bun run dev            # astro dev，App Worker 以 auxiliaryWorkers 一併啟動；預設 http://localhost:4321（被占用會換埠）
bun run preview        # astro build 後以 wrangler dev 同時跑兩個 Worker（-c web -c app），較接近部署形態
bun run e2e            # Playwright 主流程（首次先在 e2e/ 執行 bunx playwright install chromium）
```

- 會員登入需要 secrets，缺少時會員登入不可用（見「會員登入」）；本機先 `cp apps/app/.dev.vars.example apps/app/.dev.vars` 並填值（見「會員登入」）。
- 本機 D1 狀態放在 repo 根目錄的 `.wrangler/state`，`dev`、`preview` 與 `db:*` 共用；首次啟動前先 `db:migrate` 再 `db:seed`。
- 改 schema：編輯 `apps/app/src/**/schema.ts`，在 `apps/app` 執行 `bun run db:generate` 產生 migration。
- 時間一律以 UTC epoch 毫秒儲存與傳遞，只有 Web Worker 顯示時換成 Asia/Taipei。
- 測試怎麼替換「現在」：main Worker 與測試跑在同一個 isolate，`test/clock.ts` 的 `setNow()` 偽造全域 `Date`，經 RPC 呼叫的 `systemClock` 就會讀到；因此應用程式碼只能透過 `Clock` 取得時間，直接呼叫 `Date.now()` 或 `new Date()` 會繞過測試的時間控制。
- E2E 驗證 Astro、RPC 與 App Worker 的接線，不重複業務規則；它用自己的狀態（`.wrangler/e2e`，每次重建）與固定的測試 secret，不碰 `.wrangler/state` 與 `.dev.vars`，埠固定 8790。社群登入以直接寫入 session 取代（ADR 0013），production 不含任何測試登入。
- 兩個 Worker 都開啟 `observability`（Workers Logs）。部署順序固定 App 先、Web 後（ADR 0005）。

## 管理後台

`/admin`（資源列表、建立與修改資源、建立時段、查看時段內的保留與訂位、取消訂位；時間以台北時間輸入與顯示）前面放 Cloudflare Access，理由與取捨見 [ADR 0007](docs/adr/0007-admin-behind-cloudflare-access.md)。會員可在 `/me` 看到被管理者取消的訂位。
Web Worker 只把請求裡的 `Cf-Access-Jwt-Assertion` 原樣轉交給 App Worker，授權完全由 App 的管理 RPC 自己驗簽決定（RS256、`aud`、`iss`、未過期，容許 30 秒時鐘誤差）。
每個成功的管理寫入都在同一個 D1 batch 內寫一列 `admin_audit`（操作者 email），並輸出一行結構化 log。

**Fail closed**：App 的 `ACCESS_TEAM_DOMAIN` 或 `ACCESS_AUD` 為空、JWT 缺少或無效時，所有管理 RPC 一律回 `unauthorized`（`/admin` 顯示 403），沒有任何預設放行的路徑。

**每個環境的設定**：在 Zero Trust 建立保護 `/admin` 的 Access application 之後，把團隊網域與該 application 的 AUD tag 填進 `apps/app/wrangler.jsonc` 的 `env.preview.vars` 與 `env.production.vars`（`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`，純文字變數、不是 secret）。`ACCESS_TEAM_DOMAIN` 只接受 `<team>.cloudflareaccess.com`（或本機專用的 `local.invalid`），其他值一律拒絕。目前兩個環境都指向 team `photon-site-pages.cloudflareaccess.com` 與同一個 application 的 AUD（共用的取捨見 ADR 0007）。`ACCESS_JWKS_JSON` 只在團隊網域是 `local.invalid` 時採用（與真實網域並存視為設定錯誤，同樣拒絕）；`ACCESS_DEV_JWT` 只在開發模式（`import.meta.env.DEV`）讀取。兩者都只用於本機，preview / production 不得定義。

**本機開發**：沒有 Access 時，先 `bun run admin:dev-token`（可帶 email 參數）。它會產生一組測試金鑰，私鑰只寫到 `.wrangler/admin-dev/`，公鑰 JWKS 與 Access 設定（團隊網域 `local.invalid`）寫進 `apps/app/.dev.vars`，簽好的 JWT（效期 7 天） 寫進 `apps/web/.dev.vars`（`ACCESS_DEV_JWT`，只在請求沒有 Access header 時使用）；這些檔案都已 gitignore。重啟開發伺服器後開 `/admin`。

## 會員登入

會員用 LINE 或 Google 登入，不設密碼；Better Auth 放在 App Worker、以 Drizzle 存進 D1（[ADR 0008](docs/adr/0008-better-auth-in-app-worker.md)、[ADR 0009](docs/adr/0009-member-is-an-account.md)）。
Web Worker 的 middleware 把 `/api/auth/*` 原封（`redirect: "manual"`）經 Service Binding 轉給 App Worker，並以 RPC `getMemberSession(cookie)` 取得會員放進 `Astro.locals.member`（`null` = 未登入）。登入頁是 `/login?next=<站內路徑>`，登出是 `POST /api/auth/sign-out`。
Session 壽命用 Better Auth 預設值（7 天，逾 1 天的請求會延長）。延長時 Better Auth 產生的 Set-Cookie 隨 `getMemberSession` 的結果（`{ member, setCookies }`）一起回傳，由 middleware 附加到頁面回應，所以瀏覽器 cookie 與 D1 裡的 session 同步延長。沒有 Better Auth session cookie 的請求不會呼叫 RPC；RPC 失敗時 middleware 記一行 `member_session_lookup_failed` 並當作未登入，公開頁面不受影響。

- 兩種登入方式是各自獨立的會員，不以 email 自動合併（`accountLinking` 關閉；[ADR 0009](docs/adr/0009-member-is-an-account.md)）。
- LINE 會員的 email 一律是 `line-<sub>@members.holdfast.invalid`，不存 LINE 回傳的 email（[ADR 0008](docs/adr/0008-better-auth-in-app-worker.md)）；LINE 回傳的身分沒有 `sub` 時拒絕登入。Google 會員存 Google 已驗證的 email。
- OAuth token 以 AES-256-GCM 加密後才存進 D1（`account.encryptOAuthTokens`）。
- 限流開啟，計數存在 D1 的 `rate_limit`；來源 IP 只認 `cf-connecting-ip`。Web 的 middleware 轉發 `/api/auth/*` 時移除 `X-Forwarded-*`，並帶上自己收到的 `cf-connecting-ip`。
- `/api/auth/` 前綴與 cookie 前綴定義在 `apps/app/src/auth/paths.ts`，App（Better Auth 的 `basePath`、`advanced.cookiePrefix`）與 Web（`apps/web/src/auth/member.ts`）共用。
- `bun run auth:generate`（在 `apps/app`）依 `auth.cli.ts` 重新產生 `src/auth/schema.ts`，再 `bun run db:generate` 產生 migration；`auth.cli.ts` 只給 CLI 用，設定由 `createAuth` 以 placeholder 值產生，沒有第二份 Better Auth 設定要維護。
- 需要 `nodejs_compat`（Better Auth 用 AsyncLocalStorage 與 `node:crypto`），已寫在 `apps/app/wrangler.jsonc`。

**環境設定，缺少或無效時會員登入不可用**（auth 請求回 503、log 一行 `auth_config_invalid` 列出變數名稱，不含值，Web 顯示「登入暫時無法使用」；catalog 與管理 RPC 不受影響，理由見 [ADR 0008](docs/adr/0008-better-auth-in-app-worker.md)）：

| 名稱 | 種類 | 說明 |
| --- | --- | --- |
| `BETTER_AUTH_URL` | `wrangler.jsonc` 的 `vars` | 瀏覽器看到的 Web Worker 公開 origin，不含結尾斜線；OAuth 的 redirect_uri 由它組成。頂層是 `http://localhost:4321`，preview 為 `https://holdfast-preview.gravito.dev`、production 為 `https://holdfast.gravito.dev` |
| `BETTER_AUTH_SECRET` | secret | 至少 32 字元 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | secret | Google Cloud Console 的 OAuth client |
| `LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET` | secret | LINE Developers 的 LINE Login channel（Channel ID、Channel secret）；要取得 email 需另外申請權限，但我們不儲存它 |

**每個環境部署前要做的事**：

1. 在 Google 與 LINE 後台登記 callback：`<BETTER_AUTH_URL>/api/auth/callback/google` 與 `<BETTER_AUTH_URL>/api/auth/callback/line`（本機也要登記 `http://localhost:4321/...`，埠被占用時 astro 會換埠，callback 就對不上）。
2. 確認 `apps/app/wrangler.jsonc` 該環境的 `BETTER_AUTH_URL` 是 Web 的自訂網域（新環境要先填）。
3. 設定 secrets：`cd apps/app && bunx wrangler secret put BETTER_AUTH_SECRET --env <env>`，其餘四個同理。Google OAuth client 與 LINE channel 在 preview 與 production **共用同一組**，兩個環境的 callback 都要登記在同一個 client / channel；只有 `BETTER_AUTH_SECRET` 每個環境各自產生、值不同。部署工作流程會在 migration 之前檢查（見「部署」）。

**本機開發**：複製 `apps/app/.dev.vars.example` 為 `apps/app/.dev.vars`（已 gitignore，與 `admin:dev-token` 寫入的鍵並存）並填值。測試不需要它，`apps/app/vitest.config.ts` 會注入假值。

## 部署

兩個環境各有獨立的 D1 與 Worker，資料互不相通。Worker 名稱由 wrangler 的 `env` 加上後綴：

| 環境 | 網址 | App Worker | Web Worker | D1 |
| --- | --- | --- | --- | --- |
| preview | https://holdfast-preview.gravito.dev | `holdfast-app-preview` | `holdfast-web-preview` | `holdfast-preview` |
| production | https://holdfast.gravito.dev | `holdfast-app-production` | `holdfast-web-production` | `holdfast-production` |

兩個 Worker 在部署環境都不開 workers.dev；Web 只從上表的自訂網域對外（理由見 [ADR 0007](docs/adr/0007-admin-behind-cloudflare-access.md)）。

不帶 `--env` 的頂層設定只給本機開發與測試使用（本機 D1），不會被部署。各環境的 Web 只綁同環境的 App Worker。

| 觸發 | 工作流程 | 做什麼 |
| --- | --- | --- |
| Pull request、push 到 main | `.github/workflows/ci.yml` | `typecheck` 與 `test` |
| push 到 main | `.github/workflows/deploy.yml` | 部署 production |
| 手動 `workflow_dispatch`（任何分支） | `.github/workflows/deploy.yml` | 部署 preview |

部署工作流程的順序固定：檢查 secrets → 檢查會員登入設定 → `typecheck` / `test` → 套用 D1 migration → 部署 App → 建置並部署 Web。同一環境的部署排隊執行，不取消進行中的部署。

會員登入設定檢查（`apps/app/scripts/check-auth-deploy.ts`）在 migration 之前執行，任一項不符就中止並指出是哪一項：

- 該環境在 `apps/app/wrangler.jsonc` 的 `BETTER_AUTH_URL` 必須等於該環境 Web 的自訂網域（上表：preview 為 `https://holdfast-preview.gravito.dev`、production 為 `https://holdfast.gravito.dev`，不可有結尾斜線）。
- `wrangler secret list --env <env> --format json` 必須列出「會員登入」表中的所有 secret。secret 的值是 write-only，只能檢查名稱存在，值正不正確檢查不到；輸出格式不符預期（以 zod 驗證）也會中止。

新環境要先填好 `BETTER_AUTH_URL` 並設定 secrets 才能第一次部署；`wrangler secret list` 需要 Worker 已存在，全新環境若無法列出，也會中止並提示（先用 `wrangler secret put` 建立）。

需要的 GitHub secrets（Settings > Secrets and variables > Actions）；缺少任一個，工作流程在第一步就會失敗並指出缺哪個：

- `CLOUDFLARE_API_TOKEN`：需要 Workers 編輯與 D1 編輯權限
- `CLOUDFLARE_ACCOUNT_ID`

這兩個 secrets 設在 repo 層級，API token 的權限涵蓋整個 Cloudflare 帳號；任何有 write 權限的人都能從任何分支手動觸發 `workflow_dispatch`（preview）部署。

手動部署的指令（需要自己的 Cloudflare 登入或上述環境變數），`<env>` 為 `preview` 或 `production`：

```sh
bun run db:migrate:<env>   # 對遠端 D1 套用 migration
bun run deploy:app:<env>
bun run deploy:web:<env>   # 以 CLOUDFLARE_ENV=<env> 建置後部署
```

部署順序（App 先、Web 後）與 migration 的相容規則見 [ADR 0005](docs/adr/0005-web-app-split-via-rpc.md) 與 [ADR 0010](docs/adr/0010-migrations-compatible-with-both-app-versions.md)。

## MVP 範圍

**納入**：管理者手動管理資源與時段、保留、確認、會員取消與管理者取消、釋放、會員登入（LINE / Google）、管理後台。

**排除**（之後分層加入）：付款與 webhook、通知、依規則產生時段、外部 API、未到場記錄、多租戶（[ADR 0002](docs/adr/0002-single-merchant.md)）。

## 與 WebForge 的關係

Holdfast 是 [WebForge](https://github.com/CarlLee1983/WebForge) 的來源專案候選，用來實測 Cloudflare 原生架構；產品與實驗目的衝突時以實驗為準（[ADR 0001](docs/adr/0001-experiment-wins-conflicts.md)）。
它和 WebForge 已定案的應用線（Next.js、Node、PostgreSQL、自架容器與 Vercel 類平台）不同，
依 WebForge ADR 0007，不跟進的原因寫在本 repo 的 ADR。
