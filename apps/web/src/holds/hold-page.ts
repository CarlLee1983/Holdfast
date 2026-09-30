import { findResourceBySlotId } from "../catalog/find-resource";
import { taipeiDateKey } from "../catalog/taipei-time";
import { parseRecordId } from "./record-id";

export type HoldPageState<H, R> = { kind: "active"; hold: H; resource: R } | { kind: "unavailable" };

/**
 * 確認頁 `/holds/:id` 的狀態。只有「編號是正整數的標準寫法、在會員自己的有效保留裡、
 * 而且 catalog 找得到所屬資源」才是 active；其餘一律 unavailable，不區分原因
 * （不存在、已過期、已確認、屬於別人、格式非法），避免經由這一頁得知別人的保留是否存在。
 */
export function holdPageState<H extends { id: number; slotId: number }, R>(
  holds: readonly H[],
  rawId: string | undefined,
  catalog: readonly { resource: R; slots: readonly { id: number }[] }[],
): HoldPageState<H, R> {
  const unavailable = { kind: "unavailable" } as const;
  const id = parseRecordId(rawId);
  if (id === null) return unavailable;

  const hold = holds.find((h) => h.id === id);
  if (!hold) return unavailable;
  const resource = findResourceBySlotId(catalog, hold.slotId);
  return resource ? { kind: "active", hold, resource } : unavailable;
}

/** 「重新選擇時段」的連結：回到首頁，帶上這筆保留的人數與時段的台北日期。 */
export function reselectUrl(hold: { seats: number; startsAt: number }): string {
  return `/?seats=${hold.seats}&date=${taipeiDateKey(hold.startsAt)}`;
}
