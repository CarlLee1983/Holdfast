---
status: proposed
---

# 到期判定用哪個時鐘：Worker 取的 now 與 D1 執行時刻之間的超賣窗口

[ADR 0003](0003-confirm-judged-by-time.md) 說確認能否成立看「確認寫入的那一刻」是否早於到期時間，但實作的 `now` 是 Worker 在送出語句前以 Clock 取得的，不是 D1 執行語句的時刻。D1 雖然逐句執行（[ADR 0004](0004-oversell-guard-in-single-statement.md)），各語句帶的 `now` 卻可能與執行順序不一致：會員 A 在到期前取得 `now` 並送出確認，會員 B 在到期後建立保留（此時 A 的保留已不算占用）而先落地，A 的確認隨後仍成立——兩者合計可超過容量，且訂位會一直占用到取消。窗口約為一次請求的延遲（毫秒級，重送時更長）。**推論**（讀程式碼得出，未以測試重現；#8 rebase 的 security review 提出）。

目前決定：先合併 #8，把這個限制記錄在此，時鐘來源的取捨留給 `/grill-with-docs`。

**Considered Options:**
- 確認的條件 UPDATE 加上「占用 ≤ 容量」——可擋住此窗口，但違反 `CONTEXT.md` 對超占的定義（既有的保留仍應能確認）。
- 條件改以 D1 端時間判定（SQL 內取時間），所有寫入共用同一時鐘——可完全消除窗口，但測試無法再以偽造 `Date` 控制時間，與 spec #1 的 Testing Decisions（時間可替換）衝突；D1 是否提供毫秒精度的 SQL 時間函式**待查證**。
- 接受窗口並記錄——目前採用。

**Falsified if:** 確認或建立保留的條件寫入（`apps/app/src/holds/queries.ts`）改以 D1 端時間判定，或加入不違反超占定義的容量檢查；或 `apps/app/src/shared/clock.ts` 不再是應用碼取得時間的唯一途徑。
