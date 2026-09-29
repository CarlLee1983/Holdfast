import { and, eq, gt, or, sql, type SQL } from "drizzle-orm";
import { CONFIRMED, HELD, holds } from "./schema";

// 這個檔案是 catalog 與 holds 之間共用的邊界：catalog 的剩餘名額 import 這裡，
// 所以它只能依賴 holds/schema，不可以 import catalog（否則變成循環相依）。

/** 「有效保留」唯一的定義：狀態是 held 且未過期（`expires_at > now`，ADR 0003）。 */
export const activeHold = (now: number): SQL =>
  and(eq(holds.status, HELD), gt(holds.expiresAt, now))!;

/**
 * 「占住時段的一筆」唯一的定義：有效保留，或訂位（confirmed 不看到期時間，一直占用到取消（#10）為止）。
 * 占用名額與會員「同一時段一筆」的規則都用它。
 */
export const activeHoldOrBooking = (now: number): SQL => or(activeHold(now), eq(holds.status, CONFIRMED))!;

/**
 * 時段已占用名額（Seat）唯一的定義（ADR 0004：不存計數欄位，每次由子查詢算出）：有效保留與訂位的名額總和。
 * 剩餘名額列表與建立保留的條件寫入都用它，兩處不會對「占用」有不同的理解。
 *
 * `slotId` 是外層查詢裡時段 id 的 SQL 片段（例如 `sql\`s.id\``）。
 */
export function occupiedSeats(slotId: SQL, now: number): SQL<number> {
  return sql<number>`(SELECT COALESCE(SUM(${holds.seats}), 0) FROM ${holds} WHERE ${holds.slotId} = ${slotId} AND ${activeHoldOrBooking(now)})`;
}
