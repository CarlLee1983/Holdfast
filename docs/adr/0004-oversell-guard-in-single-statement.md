---
status: accepted
---

# 防超賣靠單一條件寫入語句，不存已占用計數

建立保留時，用一句 `INSERT … SELECT … WHERE (未過期保留與訂位的名額總和) + k <= 容量` 完成檢查與寫入，並以 `meta.changes` 判斷成敗；時段上不存「已占用名額」欄位。理由有二：D1 沒有跨往返的互動式交易，「先查剩餘、再寫入」在併發下不安全；而計數欄位要等釋放執行才會扣回，會違反 [ADR 0003](0003-confirm-judged-by-time.md)——過期判斷寫在加總子查詢裡（`expires_at > now`），規則就由語句本身保證。建立保留帶冪等鍵（唯一約束），因為 D1 不自動重試寫入，失敗重送可能產生重複保留。

依據（見 [`docs/research/cloudflare-concurrency.md`](../research/cloudflare-concurrency.md)）：每個 D1 資料庫單執行緒、逐句執行、寫入都到 primary——**已驗證（官方文件，經研究 agent 引用，未逐條複核）**；不支援 `BEGIN TRANSACTION`——出自 2022 年部落格，**待實測**；`batch()` 在「影響 0 列」時不回滾——**推論**。

**Considered Options:**
- 時段計數欄位加條件式 UPDATE——否決，理由同上。
- 每個時段一個 Durable Object 做序列化——保證更強，但多出 D1 與 DO 兩份資料的一致性問題；而驗證 D1 本身的併發語意正是 [ADR 0001](0001-experiment-wins-conflicts.md) 的目的。

**Consequences:** 同一句的條件也涵蓋會員層級的規則——同一時段沒有其他有效保留或訂位、有效保留總數未達上限——不另設檢查步驟。加總子查詢需要以（時段、到期時間）建索引，否則 rows read 會隨保留數成長。釋放因此不影響正確性，只負責把過期保留標記為已釋放，由每分鐘一次的 Cron 冪等執行；Queues 保留給通知、匯出、同步等真正需要佇列的工作。

**Falsified if:** 併發實測（多個請求同時搶最後幾個名額）出現超賣；或 D1 改為多寫入者／非逐句執行；或容量模型不再是計數型（`CONTEXT.md` 的「名額」改為具名席位）。
