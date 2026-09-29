import { describe, expect, it } from "vitest";
import { hasStarted } from "./slot-status";

describe("hasStarted", () => {
  it("開始時間在未來為未開始；剛好等於現在或已過為已開始", () => {
    expect(hasStarted(1001, 1000)).toBe(false);
    expect(hasStarted(1000, 1000)).toBe(true);
    expect(hasStarted(999, 1000)).toBe(true);
  });
});
