import { DAY_MS, TAIPEI_OFFSET_MS } from "../catalog/taipei-time";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 日期鍵的當天 00:00（UTC）epoch 毫秒；不是真實存在的日期（例如 2026-02-30）回傳 null。 */
function utcMidnight(key: string): number | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const epoch = Date.UTC(year, month - 1, day);
  // Date.UTC 會把 2026-02-30 進位成 3/2，所以轉回去比對才知道是不是真的存在
  return new Date(epoch).toISOString().slice(0, 10) === key ? epoch : null;
}

/** 呼叫端保證日期鍵已合法（來自 `parseDateParam` 或本檔的計算）；不合法是程式錯誤，直接丟出。 */
function requireUtcMidnight(key: string): number {
  const midnight = utcMidnight(key);
  if (midnight === null) throw new Error(`invalid date key: ${key}`);
  return midnight;
}

/** `?date=` 的解析：合法的台北日期鍵原樣回傳，缺少或非法時退回 `today`（今天的台北日期鍵）。 */
export function parseDateParam(raw: string | null, today: string): string {
  return raw !== null && utcMidnight(raw) !== null ? raw : today;
}

/** 台北日期鍵那一天的 UTC epoch 毫秒半開區間 [from, to)。 */
export function taipeiDayRange(dateKey: string): { from: number; to: number } {
  const from = requireUtcMidnight(dateKey) - TAIPEI_OFFSET_MS;
  return { from, to: from + DAY_MS };
}

/** 前一天（-1）或後一天（1）的日期鍵。 */
export function adjacentDateKey(dateKey: string, step: 1 | -1): string {
  return new Date(requireUtcMidnight(dateKey) + step * DAY_MS).toISOString().slice(0, 10);
}

/** `?resource=` 的解析：正整數，其他一律視為沒有篩選。 */
export function parseResourceParam(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
