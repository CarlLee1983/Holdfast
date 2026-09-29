import { eq, sql, type SQL } from "drizzle-orm";
import { activeHold, activeHoldOrBooking, type TimeValue } from "./occupancy";
import { holds } from "./schema";

// 會員層級的保留規則（#7）。和 occupancy 一樣，只定義 SQL 片段：建立保留的條件寫入（ADR 0004）
// 與失敗後的診斷都用這裡的片段，兩處對規則的理解不會漂移。只依賴 holds 內部（schema、occupancy），不可以 import catalog。

/** 會員同時最多持有的有效保留數。訂位不計入（CONTEXT：訂位數不限）。 */
export const MAX_ACTIVE_HOLDS_PER_MEMBER = 3;

/** 會員在該時段已有有效保留或訂位（EXISTS 子查詢；CONTEXT：同一時段最多一筆有效的保留或訂位）。 */
export function memberActiveInSlot(memberId: string, slotId: SQL, now: TimeValue): SQL {
  return sql`EXISTS (SELECT 1 FROM ${holds} WHERE ${eq(holds.memberId, memberId)} AND ${holds.slotId} = ${slotId} AND ${activeHoldOrBooking(now)})`;
}

/**
 * 會員目前有效保留的筆數（COUNT 子查詢），只算保留：訂位不占 MAX_ACTIVE_HOLDS_PER_MEMBER 的額度。
 */
export function memberActiveHoldCount(memberId: string, now: TimeValue): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM ${holds} WHERE ${eq(holds.memberId, memberId)} AND ${activeHold(now)})`;
}
