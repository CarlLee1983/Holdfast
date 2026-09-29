---
status: accepted
---

# D1 migration 必須同時相容新舊版 App Worker

部署順序是 migration → App → Web（[ADR 0005](0005-web-app-split-via-rpc.md)），所以每次 migration 套用後、新版 App 上線前，舊版 App 會對著新 schema 運行一段時間；migration 失敗重跑或 App 部署失敗時，這段時間可能更長。因此每個 migration 都必須讓舊版 App 仍能正常運作：先加欄位與資料表，等不再有程式碼使用後，再於之後的另一次合併刪除。改名以「新增 → 雙寫／搬移 → 刪舊」三步完成，不做一次到位的 rename。

**Considered Options:** 先部署 App 再套用 migration——新版 App 會對著舊 schema 運行，問題只是換邊；部署期間停機——違背 D1 與 Workers 可零停機部署的前提。

**Falsified if:** 部署流程（`.github/workflows/deploy.yml`）改為 migration 與 App 版本原子切換，或 migration 不再排在 App 部署之前。
