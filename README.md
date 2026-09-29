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
App Worker（Hono + Application + Domain）
  會員、資源與時段、保留與訂位
   ├── D1：正式業務資料，防超賣見 ADR 0004
   └── Cron：每分鐘釋放過期保留
```

每個選擇的理由都在 [docs/adr/](docs/adr/)；平台行為的查證紀錄在 [docs/research/](docs/research/)。

## 開發

需要 [Bun](https://bun.sh)（僅作套件管理與腳本執行器，執行環境一律是 workerd）。

```
apps/app   App Worker：Hono + WorkerEntrypoint RPC、領域邏輯、D1 + Drizzle（依功能分資料夾，例如 catalog）
apps/web   Web Worker：Astro + @astrojs/cloudflare，只經 Service Binding RPC 取資料，沒有 D1 binding
```

```sh
bun install
bun run typecheck      # 兩個 Worker 的型別檢查（先跑 wrangler types）
bun run test           # Vitest + @cloudflare/vitest-pool-workers，真的本機 D1，經 RPC 呼叫
bun run db:migrate     # 把 apps/app/migrations 套到本機 D1
bun run db:seed        # 寫入 2 個資源與數個時段（可重複執行，會先清空）
bun run dev            # astro dev，App Worker 以 auxiliaryWorkers 一併啟動；預設 http://localhost:4321（被占用會換埠）
bun run preview        # astro build 後以 wrangler dev 同時跑兩個 Worker（-c web -c app），較接近部署形態
```

- 本機 D1 狀態放在 repo 根目錄的 `.wrangler/state`，`dev`、`preview` 與 `db:*` 共用；首次啟動前先 `db:migrate` 再 `db:seed`。
- 改 schema：編輯 `apps/app/src/**/schema.ts`，在 `apps/app` 執行 `bun run db:generate` 產生 migration。
- 時間一律以 UTC epoch 毫秒儲存與傳遞，只有 Web Worker 顯示時換成 Asia/Taipei。
- 測試怎麼替換「現在」：main Worker 與測試跑在同一個 isolate，`test/clock.ts` 的 `setNow()` 偽造全域 `Date`，經 RPC 呼叫的 `systemClock` 就會讀到；因此應用程式碼只能透過 `Clock` 取得時間，直接呼叫 `Date.now()` 或 `new Date()` 會繞過測試的時間控制。
- 兩個 Worker 都開啟 `observability`（Workers Logs）。部署順序固定 App 先、Web 後（ADR 0005）。

## MVP 範圍

**納入**：管理者手動管理資源與時段、保留、確認、會員取消與管理者取消、釋放、會員登入（LINE / Google）、管理後台。

**排除**（之後分層加入）：付款與 webhook、通知、依規則產生時段、外部 API、未到場記錄、多租戶（[ADR 0002](docs/adr/0002-single-merchant.md)）。

## 與 WebForge 的關係

Holdfast 是 [WebForge](https://github.com/CarlLee1983/WebForge) 的來源專案候選，用來實測 Cloudflare 原生架構；產品與實驗目的衝突時以實驗為準（[ADR 0001](docs/adr/0001-experiment-wins-conflicts.md)）。
它和 WebForge 已定案的應用線（Next.js、Node、PostgreSQL、自架容器與 Vercel 類平台）不同，
依 WebForge ADR 0007，不跟進的原因寫在本 repo 的 ADR。
