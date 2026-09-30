---
status: accepted
---

# 批次建立時段用單一語句寫入

批次建立時段（#74）的所有候選時段以 JSON 陣列綁成一個參數，由**一句** `INSERT … SELECT … FROM json_each(?)` 寫入：每一列的「同資源沒有重疊」與「資源未停用」條件都寫在這一句的 WHERE 裡，所以仍是 [ADR 0004](0004-oversell-guard-in-single-statement.md) 的「檢查與寫入同一句」；`RETURNING` 帶回實際寫入的列，沒回來的候選就是被跳過的。稽核是同一個 batch 的下一句，只在前一句有寫入時才寫。

原本的規格寫的是「每筆一句，整批放同一個 D1 batch，逐句看影響列數」。改成單句的原因是 D1 的查詢數上限：每次 Worker 呼叫最多 50 次查詢（Free）或 1,000 次（Paid），**已驗證（官方文件，見 [研究文件](../research/cloudflare-concurrency.md) §3）**；batch 裡的每一句是否各算一次，官方文件沒有寫清楚——**未驗證**。若各算一次，上限 200 筆的批次在 Free 方案必定失敗。單句寫法的語句數固定，與筆數無關，也不會碰到每句 100 個綁定參數的上限。

同一批內部彼此重疊時整批拒絕，這個檢查在寫入前以純函式完成。因此單句內的重疊條件只需要看「寫入前就存在」的時段，SQLite 對讀取目標資料表的 `INSERT … SELECT` 是先算完 SELECT 還是邊寫邊讀，都不影響結果——**推論**。

**Considered Options:** 照規格每筆一句——在 Free 方案上可能撞到查詢數上限，而且這件事無法在本機驗證；分成多個 batch——失去整批原子性，稽核也無法與寫入同進退。

**Consequences:** 稽核 detail 裡的時段 ID 由 SQL 在同一個 batch 內取得（`last_insert_rowid()` 往回數 `changes()` 列），依賴 `slots.id` 是 `AUTOINCREMENT`、單一語句在單寫者的交易內配出連續的 ID——**推論**，以 RPC 測試驗證稽核的 ID 與回傳的 ID 一致。候選在寫入時全部被跳過（一筆都沒建立）時不寫稽核，與其他管理寫入「只在真的變更時寫稽核」一致。之後若有人想「照規格改回每筆一句」，應先確認上面那個未驗證的問題。

**Falsified if:** Cloudflare 文件明確寫出 batch 整批只算一次查詢，且帳號確定在 Workers Paid；或 `apps/app/src/catalog/schema.ts` 的 `slots.id` 不再是 `AUTOINCREMENT`，使稽核取 ID 的前提失效。
