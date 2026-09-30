import type { AgendaSlotLike, SlotCancelledBookingLike } from "./agenda-matrix";

export type DrawerSlotData = AgendaSlotLike;

/**
 * 當管理者在前端取消成功一筆訂位時，計算新的時段狀態，使前端抽屜與日程看板能即時無縫反應。
 */
export function applyBookingCancellation(
  slot: DrawerSlotData,
  bookingId: number,
  reason: string,
  now: number,
): DrawerSlotData {
  const targetBooking = slot.bookings.find((b) => b.id === bookingId);
  if (!targetBooking) return slot;

  const remainingBookings = slot.bookings.filter((b) => b.id !== bookingId);
  const newCancelled: SlotCancelledBookingLike = {
    id: targetBooking.id,
    memberName: targetBooking.memberName,
    seats: targetBooking.seats,
    cancelledBy: "admin",
    cancelledAt: now,
    cancellationReason: reason.trim() === "" ? null : reason.trim(),
  };

  const newOccupied = Math.max(0, slot.occupied - targetBooking.seats);
  const newRemainingSeats = Math.max(0, slot.capacity - newOccupied);
  const newOvercommitted = newOccupied > slot.capacity;

  return {
    ...slot,
    occupied: newOccupied,
    remainingSeats: newRemainingSeats,
    overcommitted: newOvercommitted,
    bookings: remainingBookings,
    cancelledBookings: [newCancelled, ...slot.cancelledBookings],
  };
}
