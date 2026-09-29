import { describe, expect, it } from "vitest";
import { describeOccupancy } from "./slot-occupancy";

describe("後台時段的占用狀態文字", () => {
  it("超占：顯示多占的名額數", () => {
    expect(describeOccupancy({ capacity: 3, occupied: 8, overcommitted: true })).toBe("超占（多占 5 個名額）");
  });

  it("占用剛好等於容量：已額滿，不算超占", () => {
    expect(describeOccupancy({ capacity: 4, occupied: 4, overcommitted: false })).toBe("已額滿");
  });

  it("還有空位：正常", () => {
    expect(describeOccupancy({ capacity: 4, occupied: 1, overcommitted: false })).toBe("正常");
  });
});
