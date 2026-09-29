# Holdfast

部署在 Cloudflare 上的訂位服務：顧客保留時段與名額，完成付款或確認後成立訂位，逾時未確認的保留自動釋放。

目前處於**決策階段**：repo 裡只有文件，架構與技術選型經過 `/grill-with-docs` 定案後才開始寫程式。

## 初始構想（未定案）

以下是開案時的候選架構，每一層都要經過 grill 與 ADR 定案，不是既定標準。

```
瀏覽器 / 外部 API 呼叫者
        │
        ▼
Cloudflare DNS / HTTPS / WAF
        │
        ▼
Web Worker（Astro + Workers Static Assets）
  公開網頁、會員頁面、管理後台、/api/* 與 /webhooks/* 入口
        │ Service Binding
        ▼
App Worker（Hono + Application + Domain）
  會員與權限、訂位、檔案、外部整合
        ├── D1：正式業務資料
        ├── R2：檔案
        └── Queues：背景工作 → Queue Consumer（匯出、通知、同步）
```

## 與 WebForge 的關係

Holdfast 是 [WebForge](https://github.com/CarlLee1983/WebForge) 的來源專案候選，用來實測 Cloudflare 原生架構。
它和 WebForge 已定案的應用線（Next.js、Node、PostgreSQL、自架容器與 Vercel 類平台）不同，
依 WebForge ADR 0007，不跟進的原因寫在本 repo 的 ADR。
