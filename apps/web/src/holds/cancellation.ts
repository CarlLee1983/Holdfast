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

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * 依資源的取消截止時間（開始前幾秒）產生給顧客看的規則文字。
 * 不足整分鐘的秒數進位到分鐘（截止只會更早，不會讓顧客誤判還來得及）。
 */
export function cancellationRuleText(cutoffSeconds: number): string {
  if (cutoffSeconds <= 0) return "開始用餐前都可自行取消";
  const totalMinutes = Math.ceil(cutoffSeconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const parts = [hours > 0 ? `${hours} 小時` : "", minutes > 0 ? `${minutes} 分鐘` : ""].filter(Boolean);
  return `可於用餐前 ${parts.join(" ")}前自行取消`;
}
