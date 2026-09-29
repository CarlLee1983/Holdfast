---
status: accepted
---

# 到期判定用資料庫推出的高水位時鐘，不直接用 Worker 取的 now

[ADR 0003](0003-confirm-judged-by-time.md) 說確認能否成立看「確認寫入的那一刻」是否早於到期時間，而原本的實作用 Worker 送出語句前以 Clock 取得的 `now`。D1 雖然逐句執行（[ADR 0004](0004-oversell-guard-in-single-statement.md)），各語句帶的 `now` 卻可能與執行順序不一致，造成兩個窗口：會員 A 在到期前取得 `now` 並送出確認，會員 B 在到期後建立保留（此時 A 的保留已不算占用）而先落地，A 的確認隨後仍成立——兩者合計超過容量，且超占與 `CONTEXT.md`「只會因管理者調降容量而發生」矛盾；或釋放以較晚的 `now` 先落地，使 A 在到期前送出的確認失敗，釋放實質參與了判定。窗口約為一次請求的延遲加上 Worker 之間的時鐘偏差。**推論**（讀程式碼得出，#8 rebase 的 security review 提出；驗收測試會以「先落地者帶較晚的 now」確定性重現）。

決定：「確認寫入的那一刻」指 D1 執行語句的時刻，時間順序以 D1 的執行順序為準。實作上以一張單列表 `clock(hwm)` 維護全域高水位：每個條件用到時間的寫入，以一個 `batch` 先執行 `hwm = max(hwm, :now)` 的 UPSERT，再執行原本的條件寫入，並以 `(SELECT hwm FROM clock)` 取代 `:now` 當作有效時間。hwm 只增不減，所以有效時間沿執行順序單調；先推進、後寫入的順序使這個性質不依賴 batch 不被其他請求插隊。上例中 B 的寫入把 hwm 推到到期之後，A 的確認落地時看到的有效時間已到期而不成立；釋放先落地時，A 的確認不成立也就是正確結果而非誤拒。

參與的寫入以規則決定而非清單：條件裡讀時間的寫入一律經過高水位（目前是建立保留、確認、釋放、會員取消、帳號刪除、刪除時段）；只記錄時間、不以時間判定的寫入（管理者取消的 `cancelled_at`、稽核紀錄的 `at`）不參與。應用碼仍只從 `Clock` 取得時間，測試仍以偽造 `Date` 控制 `:now`。

**Considered Options:**
- 確認的條件 UPDATE 加上「占用 ≤ 容量」——違反 `CONTEXT.md` 對超占的定義（既有的保留仍應能確認）。
- 條件改以 D1 端時間判定（SQL 內的 `'now'`）——`'now'` 只在單一語句內穩定、`batch` 中逐句取值；正式環境的 SQLite 版本未公開（`sqlite_version()` 被禁用），`unixepoch('subsec')` 需要 3.42，社群 2024 年回報為 3.41；官方未說明 D1 時鐘的單調性與 failover 行為；本機 D1 用真實系統時間，測試無法控制。**已驗證（本機 workerd／SQLite 3.47.0 與官方文件），正式環境版本與時鐘行為未知**。
- 寬限邊際（占用與釋放以 `expires_at + M` 判定）——只有在「取得 now 到執行的延遲 + 時鐘偏差 ≤ M」時成立，而延遲沒有上界，無法證明。
- 以 trigger 推進 hwm——trigger 寫入的列會計入 `meta.changes`（本機已驗證），現有條件寫入以它判定成敗；官方文件未列 trigger 為支援功能（**推論**支援）；drizzle-kit 不產生 trigger，重建資料表時可能悄悄遺失。
- 從 holds 的時間戳欄位推出 `MAX(...)`——刪除時段會硬刪保留紀錄（[ADR 0012](0012-slot-delete-discards-inactive-holds.md)），最大值可能跟著消失使時鐘倒退。
- 每個時段一個 hwm——目前的競態都在同一時段內，但正確性要靠「沒有跨時段的時間規則」，新增一條就悄悄失效；全域一個時鐘直接對應「執行順序即時間順序」的定義。

**Consequences:** 某個 Worker 的時鐘超前時，hwm 被推前且不回退，期間的保留會提早到期；方向是少賣而非超賣，不設上限、也不做手動重設，信任平台校時。每次時間相關的寫入多一句 UPSERT，且所有請求都寫同一列（D1 本來就逐句執行，不增加序列化）。`clock` 表與 [ADR 0010](0010-migrations-compatible-with-both-app-versions.md) 相容：舊版 App 不讀它，空表由第一次 UPSERT 建立；滾動部署期間舊版的寫入不推進 hwm，窗口在部署完成前仍存在。vitest-pool-workers 的儲存以測試檔為單位隔離（**已驗證**），測試之間時間會倒退，所以每個測試開始前要重設 `clock`。

**Falsified if:** `apps/app/src/holds/queries.ts`、`apps/app/src/admin/service.ts` 或 `apps/app/src/account/service.ts` 裡有條件讀時間的寫入不經高水位、直接使用 `:now`；或 `apps/app/src/shared/clock.ts` 不再是應用碼取得時間的唯一途徑；或發生 Worker 時鐘偏差大到使保留明顯提早到期的事件。
