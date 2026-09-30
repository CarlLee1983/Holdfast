// 管理者以台北時間輸入時間（`<input type="datetime-local">` 的值，沒有時區）；
// 資料庫與 RPC 一律是 UTC epoch 毫秒。台北沒有日光節約時間，固定 UTC+8。

const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 把台北時間的 `YYYY-MM-DDTHH:mm[:ss]` 轉成 UTC epoch 毫秒；格式或日期無效回傳 null。 */
export function parseTaipeiDateTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = DATETIME_LOCAL.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number, number, number, number, number,
  ];
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);

  // Date.UTC 會把 2 月 30 日、25 點之類的值默默進位；讀回來不一致就是無效輸入
  const check = new Date(utc);
  const valid =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second;
  return valid ? utc - TAIPEI_OFFSET_MS : null;
}

/** `parseTaipeiDateTime` 的反向：UTC epoch 毫秒轉成台北時間的 `YYYY-MM-DDTHH:mm`，用來預填 datetime-local。 */
export function formatTaipeiDateTimeInput(epochMs: number): string {
  return new Date(epochMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 16);
}
