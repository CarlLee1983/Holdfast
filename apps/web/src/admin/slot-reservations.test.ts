import { describe, expect, it } from "vitest";
import { memberIdentity, reservationStatus } from "./slot-reservations";

describe("reservationStatus", () => {
  const base = { status: "held" as const, expiresAt: 100, cancelledBy: null };

  it("到期未釋放的保留也顯示過期", () => {
    expect(reservationStatus(base, 99)).toBe("保留中");
    expect(reservationStatus(base, 100)).toBe("已過期");
  });

  it("區分已釋放、有效訂位、管理者取消與會員取消", () => {
    expect(reservationStatus({ ...base, status: "released" }, 0)).toBe("已釋放");
    expect(reservationStatus({ ...base, status: "confirmed" }, 0)).toBe("已訂位");
    expect(reservationStatus({ ...base, status: "cancelled", cancelledBy: "admin" }, 0)).toBe("管理者已取消");
    expect(reservationStatus({ ...base, status: "cancelled", cancelledBy: "member" }, 0)).toBe("已取消");
  });
});

describe("memberIdentity", () => {
  it("優先姓名，其次 email，會員資料不存在時仍顯示 memberId", () => {
    expect(memberIdentity({ memberId: "m1", memberName: "小明", memberEmail: "a@example.com" })).toBe("小明");
    expect(memberIdentity({ memberId: "m1", memberName: null, memberEmail: "a@example.com" })).toBe("a@example.com");
    expect(memberIdentity({ memberId: "m1", memberName: null, memberEmail: null })).toBe("m1");
  });
});
