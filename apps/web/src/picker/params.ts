// 首頁 GET 參數（?seats=&date=&slot=）的解析。非法值一律退回預設，不丟錯。

const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** 人數預設 2 位；資源只允許 1 位時預設 1。 */
const DEFAULT_SEATS = 2;

/** 人數：1..maxSeats 的整數，否則退回預設。沒有資源（maxSeats 為 0）時也退回 2。 */
export function parseSeats(raw: string | null, maxSeats: number): number {
  const fallback = maxSeats >= 1 ? Math.min(DEFAULT_SEATS, maxSeats) : DEFAULT_SEATS;
  if (raw === null || !POSITIVE_INTEGER.test(raw)) return fallback;
  const seats = Number(raw);
  return seats <= maxSeats ? seats : fallback;
}

/** 日期：必須是可選的日期選項，否則退回第一個可選的日期；全部都不能選時用今天。 */
export function parseDate(
  raw: string | null,
  options: readonly { value: string; disabled: boolean }[],
  today: string,
): string {
  const selectable = options.filter((o) => !o.disabled);
  if (selectable.some((o) => o.value === raw)) return raw!;
  return selectable[0]?.value ?? today;
}

/** 時段編號：正整數，否則當作沒選。這裡只驗格式，是否為目前列出的時段由 selectedSlot 判定。 */
export function parseSlotId(raw: string | null): number | null {
  if (raw === null || !POSITIVE_INTEGER.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
