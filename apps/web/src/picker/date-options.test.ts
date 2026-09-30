import { describe, expect, it } from "vitest";
import { buildDateOptions } from "./date-options";

const utc = (iso: string) => Date.parse(iso);

// 2026-09-30 是週三；台北 10/5 是週一
const NOW = utc("2026-09-30T02:00:00Z"); // 台北 10:00
const CLOSED_MONDAY = [1];

const build = (slotStarts: number[], now = NOW, days = 14) =>
  buildDateOptions({ now, days, closedWeekdays: CLOSED_MONDAY, slotStarts });

describe("buildDateOptions", () => {
  it("從今天（台北日期）起算，共 days 天", () => {
    const options = build([]);
    expect(options).toHaveLength(14);
    expect(options[0]!.value).toBe("2026-09-30");
    expect(options[13]!.value).toBe("2026-10-13");
  });

  it("有尚未開始的時段的平日可選，標籤是「月日 週幾」", () => {
    const options = build([utc("2026-10-01T11:00:00Z")]); // 台北 10/1 19:00
    expect(options[1]).toEqual({
      value: "2026-10-01",
      label: "10月1日 週四",
      heading: "10/1（週四）",
      disabled: false,
    });
  });

  it("平日沒有時段：不能選，標「無可訂時段」", () => {
    const options = build([]);
    expect(options[1]).toMatchObject({ label: "10月1日 週四（無可訂時段）", disabled: true });
  });

  it("公休日沒有時段：不能選，標「公休」", () => {
    const options = build([]);
    expect(options[5]).toMatchObject({ value: "2026-10-05", label: "10月5日 週一（公休）", disabled: true });
  });

  it("公休日但有尚未開始的時段：仍可選，不加註記", () => {
    const options = build([utc("2026-10-05T03:00:00Z")]); // 台北 10/5 11:00，週一
    expect(options[5]).toMatchObject({ label: "10月5日 週一", disabled: false });
  });

  it("已開始的時段不算（開始時間等於現在也算已開始）", () => {
    const options = build([NOW, NOW - 3_600_000]);
    expect(options[0]).toMatchObject({ label: "9月30日 週三（無可訂時段）", disabled: true });
  });

  it("今天稍晚才開始的時段讓今天可選", () => {
    const options = build([NOW + 1]);
    expect(options[0]).toMatchObject({ value: "2026-09-30", disabled: false });
  });

  it("時段依台北日期歸日：UTC 前一天 16:00 起已是台北隔天", () => {
    const options = build([utc("2026-09-30T16:00:00Z")]); // 台北 10/1 00:00
    expect(options[0]!.disabled).toBe(true);
    expect(options[1]).toMatchObject({ value: "2026-10-01", disabled: false });
  });

  it("跨台北午夜的今天：UTC 9/30 16:30 是台北 10/1，今天從 10/1 起算", () => {
    const options = build([], utc("2026-09-30T16:30:00Z"));
    expect(options[0]!.value).toBe("2026-10-01");
    expect(options[13]!.value).toBe("2026-10-14");
  });

  it("超出範圍的日期（第 15 天）與沒有選項對應的時段不影響結果", () => {
    const options = build([utc("2026-10-14T03:00:00Z")]);
    expect(options.every((o) => o.disabled)).toBe(true);
  });

  it("跨月與跨年的日期與星期正確", () => {
    const options = buildDateOptions({
      now: utc("2026-12-30T04:00:00Z"),
      days: 4,
      closedWeekdays: [],
      slotStarts: [],
    });
    expect(options.map((o) => o.label)).toEqual([
      "12月30日 週三（無可訂時段）",
      "12月31日 週四（無可訂時段）",
      "1月1日 週五（無可訂時段）",
      "1月2日 週六（無可訂時段）",
    ]);
    expect(options.map((o) => o.value)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});
