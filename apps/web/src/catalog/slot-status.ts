/** 已開始但未結束的時段仍會列出，但不可預訂。 */
export function hasStarted(slotStartsAt: number, now: number): boolean {
  return slotStartsAt <= now;
}
