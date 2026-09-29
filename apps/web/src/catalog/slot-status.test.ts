import { describe, expect, it } from "vitest";
import { hasStarted, slotAvailability } from "./slot-status";

describe("hasStarted", () => {
  it("開始時間在未來為未開始；剛好等於現在或已過為已開始", () => {
    expect(hasStarted(1001, 1000)).toBe(false);
    expect(hasStarted(1000, 1000)).toBe(true);
    expect(hasStarted(999, 1000)).toBe(true);
  });
});

describe("slotAvailability", () => {
  it("已開始優先於已額滿", () => {
    expect(slotAvailability(1000, 0, 1000)).toBe("started");
    expect(slotAvailability(999, 5, 1000)).toBe("started");
  });

  it("未開始且剩餘名額為 0（或更少）為已額滿", () => {
    expect(slotAvailability(1001, 0, 1000)).toBe("full");
    expect(slotAvailability(1001, -1, 1000)).toBe("full");
  });

  it("未開始且剩 1 個名額為開放", () => {
    expect(slotAvailability(1001, 1, 1000)).toBe("open");
  });
});
