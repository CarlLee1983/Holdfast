import { DAY_MS, TAIPEI_OFFSET_MS } from "../catalog/taipei-time";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function requireUtcMidnight(key: string): number {
  const match = DATE_KEY.exec(key);
  if (!match) throw new Error(`invalid date key: ${key}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const epoch = Date.UTC(year, month - 1, day);
  if (new Date(epoch).toISOString().slice(0, 10) !== key) {
    throw new Error(`invalid date key: ${key}`);
  }
  return epoch;
}

/** 依台北日期鍵推算其為星期幾 (1 = 週一, ..., 7 = 週日) */
export function getTaipeiDayOfWeek(dateKey: string): number {
  const epoch = requireUtcMidnight(dateKey);
  const day = new Date(epoch).getUTCDay(); // 0 is Sun, 1 is Mon, ... 6 is Sat
  return day === 0 ? 7 : day;
}

/** 找到該日期所屬週的週一 dateKey */
export function startOfWeekMonday(dateKey: string): string {
  const dow = getTaipeiDayOfWeek(dateKey);
  const offsetDays = dow - 1;
  const epoch = requireUtcMidnight(dateKey) - offsetDays * DAY_MS;
  return new Date(epoch).toISOString().slice(0, 10);
}

/** 前後 N 週的週一 dateKey */
export function adjacentWeekKey(weekMondayKey: string, step: 1 | -1): string {
  const epoch = requireUtcMidnight(weekMondayKey) + step * 7 * DAY_MS;
  return new Date(epoch).toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

export interface WeekDayInfo {
  dateKey: string;
  dayOfWeek: number; // 1 ~ 7
  label: string; // e.g. "週一 (09/28)"
}

/** 取得該週週一開始至週日的 7 天清單 */
export function getWeekDays(weekMondayKey: string): WeekDayInfo[] {
  const baseEpoch = requireUtcMidnight(weekMondayKey);
  return Array.from({ length: 7 }, (_, i) => {
    const epoch = baseEpoch + i * DAY_MS;
    const dateKey = new Date(epoch).toISOString().slice(0, 10);
    const dayOfWeek = i + 1;
    const monthDay = dateKey.slice(5).replace("-", "/");
    return {
      dateKey,
      dayOfWeek,
      label: `${WEEKDAY_NAMES[i]} (${monthDay})`,
    };
  });
}

/** 台北週區間 [from, to) 的 UTC epoch 毫秒（從週一 00:00 到下週一 00:00） */
export function taipeiWeekRange(weekMondayKey: string): { from: number; to: number } {
  const from = requireUtcMidnight(weekMondayKey) - TAIPEI_OFFSET_MS;
  return { from, to: from + 7 * DAY_MS };
}
