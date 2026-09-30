import { describe, expect, it } from "vitest";
import { slotCancellable } from "./slot-cancellable";

describe("slotCancellable", () => {
  it("開始時間晚於現在才顯示取消表單", () => {
    expect(slotCancellable(1001, 1000)).toBe(true);
  });

  it("開始時間等於現在算已開始", () => {
    expect(slotCancellable(1000, 1000)).toBe(false);
  });

  it("已開始的時段不可取消", () => {
    expect(slotCancellable(999, 1000)).toBe(false);
  });
});
