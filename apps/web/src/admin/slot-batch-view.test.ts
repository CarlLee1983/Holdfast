import { describe, expect, it } from "vitest";
import { slotBatchRows } from "./slot-batch-view";

describe("批次時段的顯示列", () => {
  it("轉成台北時間的日期與時間範圍", () => {
    expect(
      slotBatchRows([{ startsAt: Date.UTC(2026, 9, 1, 10), endsAt: Date.UTC(2026, 9, 1, 11, 30) }]),
    ).toEqual([{ date: "2026/10/01（週四）", time: "18:00–19:30" }]);
  });

  it("沒有時段就是空陣列", () => {
    expect(slotBatchRows([])).toEqual([]);
  });
});
