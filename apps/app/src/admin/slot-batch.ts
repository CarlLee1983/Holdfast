export interface SlotTimes {
  startsAt: number;
  endsAt: number;
}

export interface SlotBatchPattern {
  fromDate: string;
  toDate: string;
  weekdays: number[];
  startTimes: string[];
  durationMinutes: number;
}

export type SlotBatchRejection = "slot_batch_empty" | "slot_batch_too_large" | "slot_batch_overlaps_itself";

/** 一批最多幾個時段；擋手誤，也讓寫入的候選清單大小有界（ADR 0015）。 */
export const MAX_SLOT_BATCH_SIZE = 200;

export const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** 台北固定 UTC+8，沒有日光節約。 */
const TAIPEI_OFFSET_MS = 8 * 3_600_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" 當天 00:00 UTC 的 epoch 毫秒；格式錯或日期不存在（例如 2 月 30 日）回傳 null。 */
export function parseCalendarDate(value: string): number | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ms : null;
}

/**
 * 把「台北日曆日區間 × 星期 × 開始時間」展開成 UTC 時段，依開始時間升冪；
 * 之後依序判定：0 筆、超過上限、同批彼此重疊（[start, end) 相交，首尾相接不算）。
 * 輸入須已通過 createSlotBatchInput 的驗證。
 */
export function expandSlotBatch(
  pattern: SlotBatchPattern,
): { ok: true; slots: SlotTimes[] } | { ok: false; reason: SlotBatchRejection } {
  const from = parseCalendarDate(pattern.fromDate)!;
  const to = parseCalendarDate(pattern.toDate)!;
  const weekdays = new Set(pattern.weekdays);
  const offsets = pattern.startTimes.map((time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours! * 3_600_000 + minutes! * MINUTE_MS;
  });

  const slots: SlotTimes[] = [];
  for (let day = from; day <= to; day += DAY_MS) {
    // 台北日曆日以 UTC 午夜表示，所以 getUTCDay 就是台北的星期
    if (!weekdays.has(new Date(day).getUTCDay())) continue;
    for (const offset of offsets) {
      const startsAt = day + offset - TAIPEI_OFFSET_MS;
      slots.push({ startsAt, endsAt: startsAt + pattern.durationMinutes * MINUTE_MS });
    }
  }
  slots.sort((a, b) => a.startsAt - b.startsAt);

  if (slots.length === 0) return { ok: false, reason: "slot_batch_empty" };
  if (slots.length > MAX_SLOT_BATCH_SIZE) return { ok: false, reason: "slot_batch_too_large" };
  let latestEnd = -Infinity;
  for (const { startsAt, endsAt } of slots) {
    if (startsAt < latestEnd) return { ok: false, reason: "slot_batch_overlaps_itself" };
    latestEnd = Math.max(latestEnd, endsAt);
  }
  return { ok: true, slots };
}
