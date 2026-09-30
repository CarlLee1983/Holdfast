import { parseRecordId } from "./record-id";

export type BookingPageState<B> = { kind: "found"; booking: B } | { kind: "not-found" };

/**
 * 完成頁 `/bookings/:id` 的狀態。`bookings` 是 `listMyBookings` 的結果，只含該會員自己的訂位；
 * 編號合法且在清單內就是 found（包含已取消的），其餘一律 not-found，不區分原因（不存在、屬於別人、格式非法）。
 */
export function bookingPageState<B extends { id: number }>(
  bookings: readonly B[],
  rawId: string | undefined,
): BookingPageState<B> {
  const id = parseRecordId(rawId);
  const booking = id === null ? undefined : bookings.find((b) => b.id === id);
  return booking ? { kind: "found", booking } : { kind: "not-found" };
}

/** 完成頁的網址。 */
export function bookingPagePath(id: number): string {
  return `/bookings/${id}`;
}
