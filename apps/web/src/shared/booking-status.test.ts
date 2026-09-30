import { describe, expect, it } from "vitest";
import { holdOrBookingStatus, type HoldOrBookingState } from "./booking-status";

describe("holdOrBookingStatus", () => {
  it.each([
    ["held", "保留中"],
    ["expired", "已過期"],
    ["released", "已釋放"],
    ["confirmed", "已訂位"],
  ] as const)("displays %s", (status, expected) => {
    expect(holdOrBookingStatus({ status, cancelledBy: null })).toBe(expected);
  });

  it("distinguishes admin and member cancellation", () => {
    const cancelled: HoldOrBookingState = { status: "cancelled", cancelledBy: "admin" };
    expect(holdOrBookingStatus(cancelled)).toBe("店家已取消");
    expect(holdOrBookingStatus({ ...cancelled, cancelledBy: "member" })).toBe("已取消");
  });
});
