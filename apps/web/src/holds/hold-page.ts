import { taipeiDateKey } from "../catalog/taipei-time";
import { pickerPath } from "../picker/picker-url";
import { parseRecordId } from "./record-id";

export type HoldPageState<H> = { kind: "active"; hold: H } | { kind: "unavailable" };

/**
 * 確認頁 `/holds/:id` 的狀態。只有編號是正整數的標準寫法、且在會員自己的有效保留裡，
 * 才是 active；其餘一律 unavailable，不區分原因
 * （不存在、已過期、已確認、屬於別人、格式非法），避免經由這一頁得知別人的保留是否存在。
 */
export function holdPageState<H extends { id: number }>(
  holds: readonly H[],
  rawId: string | undefined,
): HoldPageState<H> {
  const unavailable = { kind: "unavailable" } as const;
  const id = parseRecordId(rawId);
  if (id === null) return unavailable;

  const hold = holds.find((h) => h.id === id);
  if (!hold) return unavailable;
  return { kind: "active", hold };
}

/** 「重新選擇時段」的連結：回到首頁，帶上這筆保留的人數與時段的台北日期。 */
export function reselectUrl(hold: { seats: number; startsAt: number }): string {
  return pickerPath({ seats: hold.seats, date: taipeiDateKey(hold.startsAt) });
}
