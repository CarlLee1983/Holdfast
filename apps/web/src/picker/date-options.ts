import { DAY_MS, formatTaipeiDayHeading, formatTaipeiDayLabel, taipeiDateKey } from "../catalog/taipei-time";
import { hasStarted } from "../catalog/slot-status";

export interface DateOption {
  /** 台北日期，格式 YYYY-MM-DD，同時是 GET 參數 `date` 的值。 */
  value: string;
  /** 下拉選單的文字，例如「10月1日 週四」；不能選時附註原因。 */
  label: string;
  /** 摘要列用的標題，例如「10/1（週四）」。 */
  heading: string;
  disabled: boolean;
}

interface DateOptionsInput {
  now: number;
  /** 從今天（台北日期）起算的天數。 */
  days: number;
  /** 公休的星期（0 = 週日）。 */
  closedWeekdays: readonly number[];
  /** 所有資源所有時段的開始時間（UTC epoch 毫秒），不分資源、不看人數。 */
  slotStarts: readonly number[];
}

/**
 * 首頁日期下拉的選項。有尚未開始的時段就能選（即使是公休日）；
 * 沒有時段的日子不能選，公休星期標「公休」，其他標「無可訂時段」。
 */
export function buildDateOptions({ now, days, closedWeekdays, slotStarts }: DateOptionsInput): DateOption[] {
  const openDates = new Set(slotStarts.filter((s) => !hasStarted(s, now)).map(taipeiDateKey));

  return Array.from({ length: days }, (_, i) => {
    // 台北沒有日光節約時間，逐日加 24 小時不會漂移
    const moment = now + i * DAY_MS;
    const value = taipeiDateKey(moment);
    // 日期鍵本身就是台北日期，當成 UTC 午夜解讀來取星期（0 = 週日），與 closedWeekdays 對照
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    const disabled = !openDates.has(value);
    const note = !disabled ? "" : closedWeekdays.includes(weekday) ? "（公休）" : "（無可訂時段）";
    return {
      value,
      label: `${formatTaipeiDayLabel(moment)}${note}`,
      heading: formatTaipeiDayHeading(moment),
      disabled,
    };
  });
}
