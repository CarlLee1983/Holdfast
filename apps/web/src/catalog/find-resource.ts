/** 時段所屬的資源；catalog 裡沒有這個時段（例如已結束）就回傳 null。 */
export function findResourceBySlotId<R>(
  catalog: readonly { resource: R; slots: readonly { id: number }[] }[],
  slotId: number,
): R | null {
  return catalog.find(({ slots }) => slots.some((slot) => slot.id === slotId))?.resource ?? null;
}
