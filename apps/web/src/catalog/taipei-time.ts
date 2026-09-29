// 資料庫與 RPC 一律是 UTC epoch 毫秒，只有顯示時才換成台北時間。

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
