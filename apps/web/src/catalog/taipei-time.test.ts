import { describe, expect, it } from "vitest";
import {
  formatTaipeiDate,
  formatTaipeiDayHeading,
  formatTaipeiDateTime,
  formatTaipeiDayLabel,
  formatTaipeiTime,
  taipeiDateKey,
  taipeiMinuteOfDay,
} from "./taipei-time";

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

describe("formatTaipeiDateTime", () => {
  it("日期與時間以空格相接", () => {
    expect(formatTaipeiDateTime(Date.UTC(2026, 8, 30, 11, 0))).toBe("2026/09/30（週三） 19:00");
  });

  it("跨過台北日期界線時日期與時間一起進位", () => {
    expect(formatTaipeiDateTime(Date.UTC(2026, 8, 29, 16, 30))).toBe("2026/09/30（週三） 00:30");
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

describe("formatTaipeiDayLabel", () => {
  it("顯示台北的「月日 週幾」，月日不補零", () => {
    expect(formatTaipeiDayLabel(Date.UTC(2026, 8, 30, 2, 0))).toBe("9月30日 週三");
    expect(formatTaipeiDayLabel(Date.UTC(2026, 9, 1, 2, 0))).toBe("10月1日 週四");
  });

  it("UTC 前一天 16:00 起已是台北隔天，跨年也正確", () => {
    expect(formatTaipeiDayLabel(Date.UTC(2026, 11, 31, 16, 0))).toBe("1月1日 週五");
  });
});

describe("taipeiMinuteOfDay", () => {
  it("台北當天的第幾分鐘：UTC 前一天 23:30 是台北 07:30", () => {
    expect(taipeiMinuteOfDay(Date.UTC(2026, 8, 30, 23, 30))).toBe(450);
  });

  it("台北 00:00 為 0、23:59 為 1439", () => {
    expect(taipeiMinuteOfDay(Date.UTC(2026, 8, 29, 16, 0))).toBe(0);
    expect(taipeiMinuteOfDay(Date.UTC(2026, 8, 29, 15, 59))).toBe(1439);
  });
});
