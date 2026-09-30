import { describe, expect, it } from "vitest";
import { groupByMeal } from "./meal-groups";

const utc = (iso: string) => Date.parse(iso);
const slot = (id: number, startsAt: number, resourceName = "大廳用餐") => ({ id, startsAt, resourceName });
const ids = (slots: { id: number }[]) => slots.map((s) => s.id);

describe("groupByMeal", () => {
  it("空輸入回傳空陣列，沒有時段的組不顯示", () => {
    expect(groupByMeal([], "16:00")).toEqual([]);
    const onlyDinner = groupByMeal([slot(1, utc("2026-10-01T11:00:00Z"))], "16:00"); // 台北 19:00
    expect(onlyDinner.map((g) => g.label)).toEqual(["晚餐"]);
  });

  it("分界前一分鐘（台北 15:59）是午餐，分界當下（16:00）是晚餐", () => {
    const groups = groupByMeal(
      [slot(2, utc("2026-10-01T08:00:00Z")), slot(1, utc("2026-10-01T07:59:00Z"))],
      "16:00",
    );
    expect(groups.map((g) => [g.meal, g.label, ids(g.slots)])).toEqual([
      ["lunch", "午餐", [1]],
      ["dinner", "晚餐", [2]],
    ]);
  });

  it("以台北時間判斷，不是 UTC：UTC 前一天 23:30 是台北 07:30，屬於午餐", () => {
    // UTC 9/30 23:30 = 台北 10/1 07:30；若誤用 UTC 時分（23:30）會被歸為晚餐
    const groups = groupByMeal([slot(1, utc("2026-09-30T23:30:00Z"))], "16:00");
    expect(groups.map((g) => [g.meal, ids(g.slots)])).toEqual([["lunch", [1]]]);
  });

  it("UTC 當天 08:30 是台北 16:30，屬於晚餐", () => {
    const groups = groupByMeal([slot(1, utc("2026-10-01T08:30:00Z"))], "16:00");
    expect(groups.map((g) => [g.meal, ids(g.slots)])).toEqual([["dinner", [1]]]);
  });

  it("午餐在前、晚餐在後；組內依開始時間排序，同時間依資源名稱字碼排序", () => {
    const at = utc("2026-10-01T04:00:00Z"); // 台北 12:00
    const groups = groupByMeal(
      [
        slot(1, utc("2026-10-01T11:30:00Z"), "大廳用餐"), // 19:30
        slot(2, at + 1_800_000, "大廳用餐"), // 12:30
        slot(3, at, "大廳用餐"), // 12:00
        slot(4, at, "包廂"), // 12:00，「包」(U+5305) < 「大」(U+5927)
        slot(5, utc("2026-10-01T09:00:00Z"), "包廂"), // 17:00
      ],
      "16:00",
    );
    expect(groups.map((g) => [g.label, ids(g.slots)])).toEqual([
      ["午餐", [4, 3, 2]],
      ["晚餐", [5, 1]],
    ]);
  });

  it("不改動輸入", () => {
    const input = [slot(2, utc("2026-10-01T05:00:00Z")), slot(1, utc("2026-10-01T04:00:00Z"))];
    const snapshot = [...input];
    groupByMeal(input, "16:00");
    expect(input).toEqual(snapshot);
  });

  it("分界可設定：17:30 前的 17:00 是午餐", () => {
    const groups = groupByMeal([slot(1, utc("2026-10-01T09:00:00Z"))], "17:30"); // 台北 17:00
    expect(groups.map((g) => g.meal)).toEqual(["lunch"]);
  });
});
