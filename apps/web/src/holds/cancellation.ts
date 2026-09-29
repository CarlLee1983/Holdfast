type BookingList = Extract<Awaited<ReturnType<Env["APP"]["listMyBookings"]>>, { ok: true }>["data"];
type MyBooking = BookingList[number];

export type BookingCancellation = "cancellable" | "past-cutoff" | "not-applicable";

/**
 * 訂位在 UI 上能否顯示「取消訂位」：只有已確認的訂位才適用；截止時間當下（含等號）仍可取消。
 * 只是顯示提示，取消能否成立仍由 App Worker 判定。
 */
export function bookingCancellation(
  booking: Pick<MyBooking, "status" | "cancellableUntil">,
  now: number,
): BookingCancellation {
  if (booking.status !== "confirmed") return "not-applicable";
  return now <= booking.cancellableUntil ? "cancellable" : "past-cutoff";
}
