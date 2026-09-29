# Holdfast

部署在 Cloudflare 上的單一商家訂位服務：會員先保留某個資源時段的名額，確認後成立訂位，逾時未確認的保留自動釋放。詞彙定義見 [CONTEXT.md](CONTEXT.md)。

目前處於**決策階段**：repo 裡只有文件，架構與技術選型經過 `/grill-with-docs` 定案後才開始寫程式。

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

## MVP 範圍

**納入**：管理者手動管理資源與時段、保留、確認、會員取消與管理者取消、釋放、會員登入（LINE / Google）、管理後台。

**排除**（之後分層加入）：付款與 webhook、通知、依規則產生時段、外部 API、未到場記錄、多租戶（[ADR 0002](docs/adr/0002-single-merchant.md)）。

## 與 WebForge 的關係

Holdfast 是 [WebForge](https://github.com/CarlLee1983/WebForge) 的來源專案候選，用來實測 Cloudflare 原生架構；產品與實驗目的衝突時以實驗為準（[ADR 0001](docs/adr/0001-experiment-wins-conflicts.md)）。
它和 WebForge 已定案的應用線（Next.js、Node、PostgreSQL、自架容器與 Vercel 類平台）不同，
依 WebForge ADR 0007，不跟進的原因寫在本 repo 的 ADR。
