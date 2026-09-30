import { hasStarted, slotAvailability } from "../catalog/slot-status";
import { taipeiDateKey } from "../catalog/taipei-time";
import { parseSlotId } from "./params";

/** 選定台北日期中尚未開始的時段。不改動輸入。 */
export function slotsOnDate<T extends { startsAt: number }>(slots: readonly T[], date: string, now: number): T[] {
  return slots.filter((slot) => taipeiDateKey(slot.startsAt) === date && !hasStarted(slot.startsAt, now));
}

export type PickerAvailability = "started" | "full" | "short" | "open";

/**
 * 時段對所選人數的可選狀態：在 `slotAvailability` 之上多一個「名額不足」（還有名額但少於人數）。
 * 只是顯示與選中的判定，保留能否成立仍由 App Worker 判定。
 */
export function pickerAvailability(
  slot: { startsAt: number; remainingSeats: number },
  seats: number,
  now: number,
): PickerAvailability {
  const availability = slotAvailability(slot.startsAt, slot.remainingSeats, now);
  if (availability !== "open") return availability;
  return slot.remainingSeats < seats ? "short" : "open";
}

/**
 * GET 參數 `slot` 對應的選中時段。傳入的是首頁目前列出的時段（同日期、通過人數篩選），
 * 找不到、格式不對、已額滿、剩餘名額少於人數或已開始都當作沒選。
 */
export function selectedSlot<T extends { id: number; startsAt: number; remainingSeats: number }>(
  listed: readonly T[],
  rawSlotId: string | null,
  seats: number,
  now: number,
): T | null {
  const id = parseSlotId(rawSlotId);
  if (id === null) return null;
  const slot = listed.find((s) => s.id === id);
  return slot && pickerAvailability(slot, seats, now) === "open" ? slot : null;
}
