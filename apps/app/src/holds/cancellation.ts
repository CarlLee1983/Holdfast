import { gte, sql, type SQL } from "drizzle-orm";
import { resources, slots } from "../catalog/schema";

// 取消截止時間的唯一定義。查詢語句需要 slots 與 resources 都在範圍內（join 或子查詢）。

/**
 * 取消截止時刻（UTC epoch 毫秒）= 時段開始 - 取消截止秒數。
 * 讀資源**目前**的設定，不做快照，所以修改截止設定也影響既有訂位。
 */
export const cancellableUntil: SQL<number> = sql<number>`${slots.startsAt} - ${resources.cancellationCutoffSeconds} * 1000`;

/**
 * 會員此刻仍可自行取消：`now <= 取消截止時刻`。截止時刻是最後一個可以取消的時點（CONTEXT.md），
 * 與到期不同：到期那一刻保留就失效，截止那一刻仍可取消。
 */
export const withinCancellationCutoff = (now: number): SQL => gte(cancellableUntil, now);
