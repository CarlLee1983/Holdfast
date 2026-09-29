import { describe, expect, it } from "vitest";
import { formatTaipeiDate, formatTaipeiDayHeading, formatTaipeiTime, taipeiDateKey } from "./taipei-time";

describe("台北時間格式", () => {
  it("UTC 11:00 顯示為台北 19:00，同一天", () => {
    const instant = Date.UTC(2026, 8, 30, 11, 0);

    expect(formatTaipeiDate(instant)).toBe("2026/09/30（週三）");
    expect(formatTaipeiTime(instant)).toBe("19:00");
  });

  it("UTC 16:30 跨過日期界線，顯示為台北隔天 00:30", () => {
    const instant = Date.UTC(2026, 8, 29, 16, 30);

    expect(formatTaipeiDate(instant)).toBe("2026/09/30（週三）");
    expect(formatTaipeiTime(instant)).toBe("00:30");
  });

  it("UTC 15:59 仍是台北同一天 23:59", () => {
    const instant = Date.UTC(2026, 8, 29, 15, 59);

    expect(formatTaipeiDate(instant)).toBe("2026/09/29（週二）");
    expect(formatTaipeiTime(instant)).toBe("23:59");
  });
});

describe("formatTaipeiDayHeading", () => {
  it("顯示台北的月/日與星期，月日不補零", () => {
    expect(formatTaipeiDayHeading(Date.UTC(2026, 8, 29, 16, 0))).toBe("9/30（週三）");
    expect(formatTaipeiDayHeading(Date.UTC(2026, 9, 1, 2, 0))).toBe("10/1（週四）");
  });
});

describe("taipeiDateKey", () => {
  it("UTC 15:59 與 16:00 分屬台北不同天", () => {
    expect(taipeiDateKey(Date.UTC(2026, 8, 29, 15, 59))).toBe("2026-09-29");
    expect(taipeiDateKey(Date.UTC(2026, 8, 29, 16, 0))).toBe("2026-09-30");
  });

  it("跨年時以台北日期為準", () => {
    expect(taipeiDateKey(Date.UTC(2026, 11, 31, 16, 0))).toBe("2027-01-01");
  });
});
