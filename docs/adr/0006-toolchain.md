---
status: accepted
---

# 工具鏈：TypeScript、Bun（僅套件管理）、Astro、Drizzle、Vitest on workerd

全專案 TypeScript。Bun 只負責安裝套件與跑腳本，執行環境一律是 workerd——不使用任何 Bun 專屬的執行期 API。前端全部用 Astro（互動處用 islands）；資料存取用 Drizzle，防超賣的條件語句以 Drizzle 的 `sql` 模板手寫（見 [ADR 0004](0004-oversell-guard-in-single-statement.md)）。測試用 Vitest 搭配 `@cloudflare/vitest-pool-workers`，讓測試跑在真正的 workerd 與本機 D1 上，測試本身即是對平台行為的驗證（[ADR 0001](0001-experiment-wins-conflicts.md)）。

**Falsified if:** `vitest-pool-workers` 無法在本機 D1 上重現併發行為而必須改用部署環境實測，或 Drizzle 的 D1 driver 無法表達 ADR 0004 的語句。
