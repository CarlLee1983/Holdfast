import { and, eq, gt, lte, or, sql, type SQL } from "drizzle-orm";
import { CONFIRMED, HELD, holds, RELEASED } from "./schema";

/** 時間可以是請求的 `now`（唯讀查詢），也可以是 SQL 表達式（寫入用的高水位有效時間，ADR 0011）。 */
export type TimeValue = number | SQL;

// 這個檔案是 catalog 與 holds 之間共用的邊界：catalog 的剩餘名額 import 這裡，
// 所以它只能依賴 holds/schema，不可以 import catalog（否則變成循環相依）。

/** 「有效保留」唯一的定義：狀態是 held 且未過期（`expires_at > now`，ADR 0003）。 */
export const activeHold = (now: TimeValue): SQL =>
  and(eq(holds.status, HELD), gt(holds.expiresAt, now))!;

/** 「已到期的保留」唯一的定義：狀態仍是 held 但已過期（`expires_at <= now`），恰為 `activeHold` 在 held 裡的補集；釋放清理的就是這些。 */
export const expiredHold = (now: TimeValue): SQL =>
  and(eq(holds.status, HELD), lte(holds.expiresAt, now))!;

/**
 * 「可丟棄的保留紀錄」唯一的定義：已到期的 held，或已釋放的。刪除時段只會連帶刪掉這些；
 * 訂位與任何其他狀態（例如日後的已取消）都不可丟棄，會擋住刪除（ADR 0012）。
 */
export const discardableHold = (now: TimeValue): SQL =>
  or(expiredHold(now), eq(holds.status, RELEASED))!;

/**
 * 「占住時段的一筆」唯一的定義：有效保留，或訂位（confirmed 不看到期時間，一直占用到取消為止；cancelled 不算）。
 * 占用名額與會員「同一時段一筆」的規則都用它。
 */
export const activeHoldOrBooking = (now: TimeValue): SQL => or(activeHold(now), eq(holds.status, CONFIRMED))!;

/**
 * 時段已占用名額（Seat）唯一的定義（ADR 0004：不存計數欄位，每次由子查詢算出）：有效保留與訂位的名額總和。
 * 剩餘名額列表與建立保留的條件寫入都用它，兩處不會對「占用」有不同的理解。
 *
 * `slotId` 是外層查詢裡時段 id 的 SQL 片段（例如 `sql\`s.id\``）。
 */
export function occupiedSeats(slotId: SQL, now: TimeValue): SQL<number> {
  return sql<number>`(SELECT COALESCE(SUM(${holds.seats}), 0) FROM ${holds} WHERE ${holds.slotId} = ${slotId} AND ${activeHoldOrBooking(now)})`;
}
