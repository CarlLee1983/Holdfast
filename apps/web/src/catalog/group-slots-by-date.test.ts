import { describe, expect, it } from "vitest";
import { flattenCatalog, groupSlotsByTaipeiDate } from "./group-slots-by-date";

const slot = (id: number, startsAt: number, resourceName = "大廳用餐") => ({ id, startsAt, resourceName });
const utc = (iso: string) => Date.parse(iso);

describe("groupSlotsByTaipeiDate", () => {
  it("空輸入回傳空陣列", () => {
    expect(groupSlotsByTaipeiDate([])).toEqual([]);
  });

  it("跨越台北午夜：UTC 15:59 與 16:00 分到不同天", () => {
    const groups = groupSlotsByTaipeiDate([slot(2, utc("2026-09-29T16:00:00Z")), slot(1, utc("2026-09-29T15:59:00Z"))]);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-29", "2026-09-30"]);
    expect(groups.map((g) => g.slots.map((s) => s.id))).toEqual([[1], [2]]);
  });

  it("UTC 日期與台北日期不同時，以台北日期分組", () => {
    // UTC 9/29 20:00 = 台北 9/30 04:00
    const groups = groupSlotsByTaipeiDate([slot(1, utc("2026-09-29T20:00:00Z"))]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.date).toBe("2026-09-30");
  });

  it("組內依開始時間排序，同時間依資源名稱排序", () => {
    const at = utc("2026-09-30T02:00:00Z");
    const groups = groupSlotsByTaipeiDate([
      slot(1, at + 3_600_000, "大廳用餐"),
      slot(2, at, "大廳用餐"),
      slot(3, at, "包廂"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.slots.map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it("多個資源的時段混排在同一個日期組，日期組依時間先後", () => {
    const groups = groupSlotsByTaipeiDate([
      slot(1, utc("2026-10-01T02:00:00Z"), "包廂"),
      slot(2, utc("2026-09-30T04:00:00Z"), "大廳用餐"),
      slot(3, utc("2026-09-30T02:00:00Z"), "包廂"),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-30", "2026-10-01"]);
    expect(groups[0]!.slots.map((s) => s.id)).toEqual([3, 2]);
  });

  it("標題含月/日與星期（台北）", () => {
    const groups = groupSlotsByTaipeiDate([slot(1, utc("2026-09-29T16:00:00Z"))]);
    expect(groups[0]!.heading).toBe("9/30（週三）");
  });

  it("不改動輸入陣列", () => {
    const input = [slot(2, 2000), slot(1, 1000)];
    groupSlotsByTaipeiDate(input);
    expect(input.map((s) => s.id)).toEqual([2, 1]);
  });
});

describe("flattenCatalog", () => {
  it("每個時段帶上所屬資源的名稱與單筆名額上限", () => {
    const flat = flattenCatalog([
      { resource: { name: "大廳用餐", seatsPerHold: 4 }, slots: [{ id: 1 }, { id: 2 }] },
      { resource: { name: "包廂", seatsPerHold: 8 }, slots: [] },
      { resource: { name: "課程", seatsPerHold: 1 }, slots: [{ id: 3 }] },
    ]);
    expect(flat).toEqual([
      { id: 1, resourceName: "大廳用餐", seatsPerHold: 4 },
      { id: 2, resourceName: "大廳用餐", seatsPerHold: 4 },
      { id: 3, resourceName: "課程", seatsPerHold: 1 },
    ]);
  });

  it("空目錄回傳空陣列", () => {
    expect(flattenCatalog([])).toEqual([]);
  });
});
