import { sql, type SQL } from "drizzle-orm";
import { toD1Statement } from "./d1-statement";

// 高水位時鐘的共用機制（ADR 0011）：時間順序以 D1 的執行順序為準，
// 條件讀時間的寫入一律「先推進、後寫入」，並以高水位取代請求帶來的 now 當作有效時間。

/** 有效時間：語句內取代 `:now` 的 SQL 片段；只在 `bumpClock` 之後的語句裡有值。 */
export const effectiveNow: SQL<number> = sql<number>`(SELECT hwm FROM clock WHERE id = 1)`;

/** 推進高水位的 UPSERT；hwm 只增不減，空表由第一次呼叫建立。 */
const bumpClock = (now: number): SQL =>
  sql`INSERT INTO clock (id, hwm) VALUES (1, ${now}) ON CONFLICT (id) DO UPDATE SET hwm = max(hwm, excluded.hwm)`;

export interface BumpedWriteResult {
  /** 條件寫入那句自己的受影響列數（成敗只看它）。 */
  changes: number;
  /** 寫入之後讀到的高水位：寫入當時採用的有效時間之下界，診斷用它解釋失敗（不影響正確性）。 */
  effectiveNow: number;
}

/**
 * 以一個 batch 先推進高水位、再執行條件寫入 `write`（其中的時間一律用 `effectiveNow`），
 * 最後讀回高水位給呼叫端診斷。成敗只看寫入那句自己的 `meta.changes`（第二個結果），不看推進那句。
 *
 * 用原生 D1 batch 而不是 drizzle 的 `db.batch`，原因見 `toD1Statement`。
 */
export async function writeAtEffectiveNow(d1: D1Database, now: number, write: SQL): Promise<BumpedWriteResult> {
  const [, written, read] = await d1.batch<{ hwm: number }>([
    toD1Statement(d1, bumpClock(now)),
    toD1Statement(d1, write),
    toD1Statement(d1, sql`SELECT hwm FROM clock WHERE id = 1`),
  ]);
  return { changes: written!.meta.changes, effectiveNow: read!.results[0]!.hwm };
}
