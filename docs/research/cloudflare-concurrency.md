# Cloudflare 平台併發與排程事實（為防超賣設計蒐集）

查證日期：2026-09-29。來源限 developers.cloudflare.com 與 blog.cloudflare.com。
標記規則：**已驗證（官方文件）** 表示文件原文直接陳述；**推論** 表示由已驗證事實推導、文件未直接寫明，寫進 ADR 前應實測。本文未做任何實驗。

情境：每個時段有計數容量（例如 20 席），會員建立占用 k 席的 hold，並發下絕不可超賣；hold 約 10 分鐘過期，過期與否在 confirm 時以時間戳判斷，釋放 job 只負責清理。

---

## 1. D1 寫入併發模型

**單一執行緒、逐一處理。** 「Each individual D1 database is inherently single-threaded, and processes queries one at a time.」過載時先排隊，佇列滿則回 overloaded 錯誤。**已驗證（官方文件）**
- https://developers.cloudflare.com/d1/reference/faq/
- https://developers.cloudflare.com/d1/platform/limits/

**所有寫入都送到單一 primary。** 未啟用讀取複寫時，讀寫都路由到位於一個地點的 primary；啟用後「All write queries are still forwarded to the primary database instance」。**已驗證（官方文件）**
- https://developers.cloudflare.com/d1/best-practices/read-replication/

**auto-commit；`batch()` 是交易。** 原文：「D1 operates in auto-commit. Our implementation guarantees that each statement in the list will execute and commit, sequentially, non-concurrently. Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence.」**已驗證（官方文件）**
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

**單一敘述是原子的。** 文件只說 auto-commit；依 SQLite 語意，auto-commit 下每個敘述自成一個交易。**推論**（由上條 + SQLite 語意）

**不支援互動式交易（跨往返的 BEGIN … COMMIT）。** 2022 年官方部落格：「if you try running `BEGIN TRANSACTION` in D1 you'll get an error」，理由是 Worker 可能開了交易後崩潰、卡住唯一的寫入者。同文提出的 `db.transaction()`（stored procedure 形式）當時標示為規劃中；現行 D1 Worker API 文件中找不到此 API。**已驗證（官方部落格，2022-09-27）**；「至今仍未提供互動式交易」為 **推論**（依現行 API 文件未列出）。
- https://blog.cloudflare.com/whats-new-with-d1/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/ （匯入時需移除 BEGIN TRANSACTION / COMMIT）

**條件式單句能否防超賣。** 例如
`UPDATE slot SET used = used + ?1 WHERE id = ?2 AND used + ?1 <= capacity`
或 `INSERT INTO hold (...) SELECT ... WHERE (SELECT COALESCE(SUM(k),0) FROM hold WHERE slot=? AND active) + ? <= capacity`。
由於資料庫單一執行緒逐一處理、單句在 auto-commit 下原子，檢查與寫入之間不可能插入其他寫入，因此可靠。多句（先 UPDATE 計數、再 INSERT hold）放進同一個 `batch()` 也原子。**推論**（由上述已驗證事實推得，建議以並發壓測驗證）。
注意：`batch()` 內某句「影響 0 列」不是錯誤，不會觸發回滾——若第一句條件 UPDATE 沒成功、第二句 INSERT 仍會執行。需把條件寫進每一句（例如 INSERT … SELECT … WHERE changes() > 0，或 INSERT 自帶容量子查詢）。**推論**（文件只說「statement fails」才回滾）。

**偵測成功：`meta.changes`。** D1Result 的 `meta` 含 `changes`（「the number of changes made to the database」）、`rows_written`、`last_row_id`、`changed_db`、`total_attempts`。**已驗證（官方文件）**
- https://developers.cloudflare.com/d1/worker-api/return-object/

**`RETURNING`。** D1 文件未提及 `RETURNING`；prepared statements 頁寫「`results` is empty for write operations such as `UPDATE`, `DELETE`, or `INSERT`」（指未帶 RETURNING 的一般寫入）。SQLite 3.35+ 支援 `RETURNING`，D1 很可能可用，但**文件未載明，屬推論，需實測**。以 `meta.changes === 1` 判斷條件更新是否成功不依賴 RETURNING。
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/

**自動重試只涵蓋唯讀查詢。** D1 會對只含 SELECT / EXPLAIN / WITH 的查詢自動重試最多兩次；寫入需由應用自行重試（retry 頁建議對暫時性錯誤重試寫入，但未討論冪等性，也未說明「回錯誤但其實已寫入」的情況）。**已驗證（官方文件）**
- https://developers.cloudflare.com/changelog/2025-09-11-d1-automatic-read-retries/
- https://developers.cloudflare.com/d1/best-practices/retry-queries/

## 2. D1 讀取複寫與 Sessions API

- 讀取複寫需在 dashboard 對資料庫層級**手動啟用**；且必須透過 Sessions API（`withSession()`），否則所有查詢仍只由 primary 執行。**已驗證（官方文件）**
- 複本為非同步複製，「a read replica may be arbitrarily out of date」；不用 Sessions 時會發生寫後讀不到自己寫入。**已驗證（官方文件）**
- Sessions API 提供 sequential consistency：monotonic reads、monotonic writes、writes follow reads、read my own writes（**限同一 session 內**，靠 bookmark 串接）。`withSession()` = `"first-unconstrained"`（第一句可能打到任一複本）；`withSession("first-primary")` 第一句打 primary；傳入 bookmark 則保證版本至少與該 bookmark 一樣新。**已驗證（官方文件）**
- 讀取複本不另收費。**已驗證（官方文件）**
- 來源：https://developers.cloudflare.com/d1/best-practices/read-replication/ 、https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession 、https://developers.cloudflare.com/d1/platform/pricing/

對本設計：跨 session（不同會員、不同請求且未帶 bookmark）讀到的剩餘席位可能過時；但寫入一律在 primary 單執行緒執行，只要容量檢查寫在寫入敘述本身，複寫不影響防超賣。**推論**

## 3. D1 相關限制

| 項目 | Workers Free | Workers Paid | 標記 |
| --- | --- | --- | --- |
| 單一資料庫大小上限 | 500 MB | 10 GB | 已驗證（官方文件） |
| 每帳號資料庫數 | 10 | 50,000 | 已驗證（官方文件） |
| 每次 Worker 呼叫可發的查詢數 | 50 | 1,000 | 已驗證（官方文件） |
| 單一查詢最長時間 | 30 秒 | 30 秒 | 已驗證（官方文件） |
| 每查詢綁定參數 | 100 | 100 | 已驗證（官方文件） |
| 每次呼叫同時連線 | 6 | 6 | 已驗證（官方文件） |

來源：https://developers.cloudflare.com/d1/platform/limits/

吞吐指引：吞吐量直接取決於查詢耗時——平均 1 ms 約 1,000 QPS、100 ms 約 10 QPS。**已驗證（官方文件）**，同上連結。
計費：Free 每日 500 萬 rows read / 10 萬 rows written；Paid 每月含 250 億 read、5,000 萬 written。索引會使寫入多算一列。**已驗證（官方文件）** https://developers.cloudflare.com/d1/platform/pricing/

## 4. Durable Objects 作為每時段 / 每資源的序列化器

- 每個物件有全域唯一名稱，執行模型為「single-threaded and cooperatively multi-tasked」，可作為 Workers 之間的單一協調點；儲存「durable, transactional, and strongly consistent」，每物件上限 10 GB。**已驗證（官方文件）** https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- **Input gate**：儲存操作執行中，除了儲存完成事件外不投遞其他事件給物件；**Output gate**：寫入進行中時，對外訊息會被扣住直到寫入完成，寫入失敗則丟棄並回錯誤。**Input gate 不涵蓋 `fetch()` 等非儲存 I/O**——await 外部 fetch 期間其他請求可交錯進來。**已驗證（官方部落格，2021-08-03）** https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/
- SQLite 後端：沒有中間 `await` 的一連串寫入會自動原子提交；「a series of reads followed by a series of writes (with no other intervening I/O) are automatically atomic and behave like a transaction」；`sql.exec()` 不能執行 `BEGIN TRANSACTION` / `SAVEPOINT`，改用 `ctx.storage.transactionSync()` / `transaction()`。**已驗證（官方文件）** https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- 單一物件軟上限約 1,000 requests/s；物件數量不限。**已驗證（官方文件）** https://developers.cloudflare.com/durable-objects/platform/limits/
- **Free 方案可用，但僅限 SQLite 後端**；Free：每日 10 萬 requests、13,000 GB-s；Paid：每月 100 萬 requests + $0.15/百萬、40 萬 GB-s + $12.50/百萬 GB-s。requests 含 HTTP、RPC session、WebSocket 訊息與 alarm 觸發；每次對 DO stub 的 RPC 方法呼叫算一個 request。SQLite 儲存計費與 D1 相同級距（Free 每日 500 萬 read / 10 萬 write，5 GB）。**已驗證（官方文件）** https://developers.cloudflare.com/durable-objects/platform/pricing/ 、https://developers.cloudflare.com/workers/platform/pricing/#durable-objects

## 5. 過期與清理機制

### Queues
- `delaySeconds` 上限 **24 小時**（send 與 retry 皆適用）。**已驗證（官方文件）** https://developers.cloudflare.com/queues/configuration/batching-retries/#delay-messages 、https://developers.cloudflare.com/queues/platform/limits/
- 預設 **at-least-once**，罕見情況會重複投遞；官方建議用唯一 ID 作冪等鍵。**已驗證（官方文件）** https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- `max_retries` 預設 3（上限 100）；批次中一則失敗且未個別 ack 時整批重試；達上限後若設定 DLQ 則寫入 DLQ，否則**永久刪除**。**已驗證（官方文件）** https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- Free 方案可用：訊息保留固定 24 小時；每日 10,000 operations，一則訊息通常 3 次操作（寫、讀、刪）。**已驗證（官方文件）** https://developers.cloudflare.com/queues/platform/pricing/

### Cron Triggers
- 最細粒度為**每分鐘**（cron 表達式分鐘欄 0-59，範例「At every minute」）；以 UTC 執行；新增 / 修改需最多 15 分鐘傳播。**已驗證（官方文件）** https://developers.cloudflare.com/workers/configuration/cron-triggers/
- 每帳號 Cron Trigger 數：Free 5、Paid 250；Free 每次 cron CPU 10 ms。**已驗證（官方文件）** https://developers.cloudflare.com/workers/platform/limits/

### Durable Object Alarms
- 每個物件同時只能有**一個** alarm，再呼叫 `setAlarm()` 會覆蓋；可在儲存中保存排程表、由 `alarm()` 處理到期事件後再排下一個。保證 **at-least-once**，handler 丟例外時以指數退避（自 2 秒起）重試最多 6 次；每次 `setAlarm()` 計為寫入一列。**已驗證（官方文件）** https://developers.cloudflare.com/durable-objects/api/alarms/ 、https://developers.cloudflare.com/durable-objects/platform/pricing/

## 6. Service Bindings

- 「zero overhead or added latency」，預設兩個 Worker 在同一台伺服器的同一執行緒上執行。**已驗證（官方文件）** https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- 支援 RPC：繼承 `WorkerEntrypoint` 並公開方法，其他 Worker 透過 binding 直接呼叫。**已驗證（官方文件）** https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
- 計費（Standard 模式）：A 經 Service Binding 呼叫 B（fetch 或 RPC）只算**一個 request**，CPU 時間合計；舊的 Bundled / Unbound 方案則算兩次。**已驗證（官方文件）** https://developers.cloudflare.com/workers/platform/pricing/#service-bindings
- 每次 Service Binding 呼叫計入 subrequest 上限；單一請求最多 32 次 Worker 呼叫。**已驗證（官方文件）** https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/

---

## 對設計的含意（全部為 **推論**）

1. 以 D1 實作時，防超賣的正確性可以只靠「條件寫在寫入敘述裡」達成：單句條件 UPDATE / INSERT…SELECT，或條件分散到 `batch()` 內每一句，再以 `meta.changes` 判斷成敗。不能採用「先 SELECT 剩餘量、再在另一個往返 UPDATE」的應用層檢查，因為沒有互動式交易。
2. `batch()` 只在敘述**出錯**時回滾，「影響 0 列」不回滾；多句流程必須讓後續敘述自帶條件，或改用單句設計。
3. 若容量以「計算有效 hold 總和」而非計數欄位實作，過期判斷可直接放進子查詢（`expires_at > ?now`），與「confirm 時比對時間戳、釋放 job 只清理」的模型一致；需要索引避免 rows read 膨脹。
4. 寫入重試可能在「實際已提交但回傳錯誤」時造成重複 hold，建立 hold 應帶冪等鍵（唯一約束）。文件未討論此情況，這一點需要實測或保守處理。
5. 讀取複寫不影響寫入正確性，但顯示給會員的剩餘席位可能過時；若啟用，對剛寫入的會員應以 bookmark 延續 session。
6. 單一 D1 的吞吐由查詢耗時決定；短小的條件寫入（毫秒級）足以應付一般預約量，熱門時段瞬間湧入時可能遇 overloaded，需重試與退避。
7. Durable Objects（每時段一個物件）提供更強的序列化且 Free 可用，但物件內若 await 外部 fetch 會讓其他請求交錯，臨界區內只能做儲存操作；也多了一層請求計費與「D1 與 DO 之間資料一致」的問題。
8. 清理機制三選一都可行：Cron（最細每分鐘、Free 僅 5 個且 CPU 10 ms）、Queues `delaySeconds: 600`（at-least-once，清理必須冪等）、DO alarm（每物件單一 alarm，需自行維護排程表）。既然過期由 confirm 時的時間戳判定，清理延遲或重複只影響整潔度，不影響正確性，最簡單的每分鐘 Cron 已足夠。
9. Service Binding / RPC 拆分服務不增加 request 費用或延遲，拆分 Worker 的成本主要在 32 次呼叫上限與設計複雜度。
