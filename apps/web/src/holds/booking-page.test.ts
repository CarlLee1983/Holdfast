import { describe, expect, it } from "vitest";
import { bookingPageState } from "./booking-page";

const bookings = [
  { id: 7, status: "confirmed" },
  { id: 8, status: "cancelled" },
];

describe("bookingPageState", () => {
  it("在清單內：回傳該筆訂位，不論狀態（已取消的也是 found）", () => {
    expect(bookingPageState(bookings, "7")).toEqual({ kind: "found", booking: bookings[0] });
    expect(bookingPageState(bookings, "8")).toEqual({ kind: "found", booking: bookings[1] });
  });

  it("編號不在傳入的清單裡：not-found（清單只含該會員自己的訂位，擁有權由 E2E 驗證）", () => {
    expect(bookingPageState(bookings, "99")).toEqual({ kind: "not-found" });
    expect(bookingPageState([], "7")).toEqual({ kind: "not-found" });
  });

  it.each(["", "abc", "0", "-7", "07", "7.0", undefined])("編號格式不合法（%j）：not-found", (raw) => {
    expect(bookingPageState(bookings, raw)).toEqual({ kind: "not-found" });
  });
});
