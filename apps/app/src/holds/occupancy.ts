import { and, eq, gt, sql, type SQL } from "drizzle-orm";
import { HELD, holds } from "./schema";

// 這個檔案是 catalog 與 holds 之間共用的邊界：catalog 的剩餘名額 import 這裡，
// 所以它只能依賴 holds/schema，不可以 import catalog（否則變成循環相依）。

export { HELD };

/** 「有效保留」唯一的定義：狀態是 held 且未過期（`expires_at > now`，ADR 0003）。 */
export const activeHold = (now: number): SQL =>
  and(eq(holds.status, HELD), gt(holds.expiresAt, now))!;

/**
 * 時段已占用名額（Seat）唯一的定義（ADR 0004：不存計數欄位，每次由子查詢算出）：有效保留的名額總和。
 * 剩餘名額列表與建立保留的條件寫入都用它，兩處不會對「占用」有不同的理解。
 *
 * #8 加入訂位後，有效訂位的名額也要加進這裡。
 * `slotId` 是外層查詢裡時段 id 的 SQL 片段（例如 `sql\`s.id\``）。
 */
export function occupiedSeats(slotId: SQL, now: number): SQL<number> {
  return sql<number>`(SELECT COALESCE(SUM(${holds.seats}), 0) FROM ${holds} WHERE ${holds.slotId} = ${slotId} AND ${activeHold(now)})`;
}
