---
status: accepted
---

# 刪除時段只連帶刪除已失效的保留紀錄

`holds.slot_id` 有外鍵指向 `slots`，所以時段底下只要還有任何一列 holds，就無法刪除。刪除時段時，連帶硬刪除其中「已到期的 held」與「已釋放的」紀錄（它們不占名額，也不再有人需要）；只要還有任何其他紀錄——有效保留、訂位（confirmed），或日後的其他狀態如已取消的訂位——就拒絕刪除（`slot_in_use`）。這樣訂位歷史（含已取消的訂位，見母規格 #1 的使用者故事 33 與 `apps/app/src/holds/schema.ts` 的註記）不會因為刪時段而被抹掉。判定是「不存在不可丟棄的紀錄」，而不是「存在有效紀錄」，所以新增的狀態預設會擋住刪除，而不是被悄悄刪掉。

**Considered Options:** 連同所有 holds 一併刪除——會抹掉訂位與取消的歷史；只擋有效保留與訂位、其餘照刪——日後新增的狀態（如已取消）會被悄悄刪掉；改成軟刪除時段——需要新欄位並讓每個讀取時段的查詢都排除它，目前沒有需求。

**Consequences:** 「可丟棄」的定義只在 `discardableHold`，判定、稽核、刪除三句共用同一個條件，在同一個 batch 內執行（[ADR 0004](0004-oversell-guard-in-single-statement.md) 的做法）。新增 holds 狀態時要決定它是否可丟棄；預設不是。

**Falsified if:** `apps/app/src/holds/schema.ts` 移除 `holds.slot_id` 的外鍵，或訂位歷史改存到別處；或 `apps/app/src/holds/occupancy.ts` 的 `discardableHold` 判定改成不看狀態。
