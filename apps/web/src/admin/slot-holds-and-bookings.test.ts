import { describe, expect, it } from "vitest";
import { memberIdentity } from "./slot-holds-and-bookings";

describe("memberIdentity", () => {
  it("優先姓名，其次 email，會員資料不存在時仍顯示 memberId", () => {
    expect(memberIdentity({ memberId: "m1", memberName: "小明", memberEmail: "a@example.com" })).toBe("小明");
    expect(memberIdentity({ memberId: "m1", memberName: null, memberEmail: "a@example.com" })).toBe("a@example.com");
    expect(memberIdentity({ memberId: "m1", memberName: null, memberEmail: null })).toBe("m1");
  });
});
