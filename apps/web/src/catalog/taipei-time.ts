// 資料庫與 RPC 一律是 UTC epoch 毫秒，只有顯示時才換成台北時間。

export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台北固定 UTC+8，沒有日光節約時間
export const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

const timeFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTaipeiDate(epochMs: number): string {
  return dateFormat.format(epochMs);
}

export function formatTaipeiTime(epochMs: number): string {
  return timeFormat.format(epochMs);
}

/** 日期加時間，例如「2026/09/30（週三） 19:00」。 */
export function formatTaipeiDateTime(epochMs: number): string {
  return `${formatTaipeiDate(epochMs)} ${formatTaipeiTime(epochMs)}`;
}

const dayHeadingFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

function dayParts(epochMs: number) {
  const parts = dayHeadingFormat.formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { month: part("month"), day: part("day"), weekday: part("weekday") };
}

/** 摘要列的日期標題，例如「9/30（週三）」。 */
export function formatTaipeiDayHeading(epochMs: number): string {
  const { month, day, weekday } = dayParts(epochMs);
  return `${month}/${day}（${weekday}）`;
}

/** 日期下拉選單的文字，例如「9月30日 週三」。 */
export function formatTaipeiDayLabel(epochMs: number): string {
  const { month, day, weekday } = dayParts(epochMs);
  return `${month}月${day}日 ${weekday}`;
}

/** 台北當天的第幾分鐘（0–1439）。 */
export function taipeiMinuteOfDay(epochMs: number): number {
  return Math.floor(((epochMs + TAIPEI_OFFSET_MS) % DAY_MS) / 60_000);
}

/** 台北日期鍵 YYYY-MM-DD，可直接字串排序，用來分組。 */
export function taipeiDateKey(epochMs: number): string {
  return new Date(epochMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}
