import { describe, expect, it } from "vitest";
import { applyBookingCancellation, type DrawerSlotData } from "./slot-drawer-state";

describe("applyBookingCancellation", () => {
  const initialSlot: DrawerSlotData = {
    id: 10,
    resourceId: 1,
    resourceName: "大廳用餐",
    resourceRetiredAt: null,
    startsAt: 1700000000,

    endsAt: 1700003600,
    capacity: 10,
    occupied: 6,
    remainingSeats: 4,
    overcommitted: false,
    bookings: [
      { id: 101, memberName: "王小明", seats: 2 },
      { id: 102, memberName: "李大同", seats: 4 },
    ],
    holds: [],
    cancelledBookings: [],
  };

  it("取消訂位後：將訂位移至已取消，歸還名額並重新計算剩餘名額", () => {
    const updated = applyBookingCancellation(initialSlot, 101, "店家停業消毒", 1700001000);

    expect(updated.occupied).toBe(4);
    expect(updated.remainingSeats).toBe(6);
    expect(updated.overcommitted).toBe(false);
    expect(updated.bookings).toHaveLength(1);
    expect(updated.bookings[0]!.id).toBe(102);

    expect(updated.cancelledBookings).toHaveLength(1);
    expect(updated.cancelledBookings[0]).toEqual({
      id: 101,
      memberName: "王小明",
      seats: 2,
      cancelledBy: "admin",
      cancelledAt: 1700001000,
      cancellationReason: "店家停業消毒",
    });
  });

  it("若原時段超占，取消訂位後若仍超占，維持 overcommitted=true", () => {
    const overcommittedSlot: DrawerSlotData = {
      ...initialSlot,
      capacity: 3,
      occupied: 6,
      remainingSeats: 0,
      overcommitted: true,
    };

    const updated = applyBookingCancellation(overcommittedSlot, 101, "", 1700001000);
    expect(updated.occupied).toBe(4);
    expect(updated.remainingSeats).toBe(0);
    expect(updated.overcommitted).toBe(true); // 4 > 3
  });

  it("若找不到該訂位編號，回傳原時段物件不變更", () => {
    const updated = applyBookingCancellation(initialSlot, 999, "", 1700001000);
    expect(updated).toBe(initialSlot);
  });
});
