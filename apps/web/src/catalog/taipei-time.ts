// 資料庫與 RPC 一律是 UTC epoch 毫秒，只有顯示時才換成台北時間。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台北固定 UTC+8，沒有日光節約時間

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

const dayHeadingFormat = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

/** 日期分組的標題，例如「9/30（週三）」。 */
export function formatTaipeiDayHeading(epochMs: number): string {
  const parts = dayHeadingFormat.formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("month")}/${part("day")}（${part("weekday")}）`;
}

/** 台北日期鍵 YYYY-MM-DD，可直接字串排序，用來分組。 */
export function taipeiDateKey(epochMs: number): string {
  return new Date(epochMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}
