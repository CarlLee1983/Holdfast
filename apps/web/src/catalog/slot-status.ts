/** 已開始但未結束的時段仍會列出，但不可預訂。 */
export function hasStarted(slotStartsAt: number, now: number): boolean {
  return slotStartsAt <= now;
}

export type SlotAvailability = "started" | "full" | "open";

/**
 * 時段在 UI 上的可保留狀態：已開始優先於已額滿。只是顯示提示，
 * 保留能否成立仍由 App Worker 判定。
 */
export function slotAvailability(slotStartsAt: number, remainingSeats: number, now: number): SlotAvailability {
  if (hasStarted(slotStartsAt, now)) return "started";
  return remainingSeats <= 0 ? "full" : "open";
}
