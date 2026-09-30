import { formatTaipeiDate, formatTaipeiTime } from "../catalog/taipei-time";

/** 時段的起訖時間（UTC epoch 毫秒），與 App 同名。 */
export interface SlotTimes {
  startsAt: number;
  endsAt: number;
}

/** 批次預覽與結果清單的一列：台北時間的日期與時間範圍。 */
export function slotBatchRows(slots: readonly SlotTimes[]) {
  return slots.map((s) => ({
    date: formatTaipeiDate(s.startsAt),
    time: `${formatTaipeiTime(s.startsAt)}–${formatTaipeiTime(s.endsAt)}`,
  }));
}
