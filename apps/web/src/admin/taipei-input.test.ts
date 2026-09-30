import { describe, expect, it } from "vitest";
import { formatTaipeiDateTimeInput, parseTaipeiDateTime } from "./taipei-input";

describe("台北時間的 datetime-local 輸入轉 UTC epoch 毫秒", () => {
  it("台北 19:00 = UTC 11:00，同一天", () => {
    expect(parseTaipeiDateTime("2026-09-30T19:00")).toBe(Date.UTC(2026, 8, 30, 11, 0));
  });

  it("台北 00:30 跨過日期界線，是 UTC 前一天 16:30", () => {
    expect(parseTaipeiDateTime("2026-09-30T00:30")).toBe(Date.UTC(2026, 8, 29, 16, 30));
  });

  it("台北 07:59 仍在 UTC 前一天，08:00 才是 UTC 當天 00:00", () => {
    expect(parseTaipeiDateTime("2026-09-30T07:59")).toBe(Date.UTC(2026, 8, 29, 23, 59));
    expect(parseTaipeiDateTime("2026-09-30T08:00")).toBe(Date.UTC(2026, 8, 30, 0, 0));
  });

  it("跨年：台北 2027-01-01 00:00 = UTC 2026-12-31 16:00", () => {
    expect(parseTaipeiDateTime("2027-01-01T00:00")).toBe(Date.UTC(2026, 11, 31, 16, 0));
  });

  it("接受帶秒的格式", () => {
    expect(parseTaipeiDateTime("2026-09-30T19:00:30")).toBe(Date.UTC(2026, 8, 30, 11, 0, 30));
  });

  it.each([
    ["空字串", ""],
    ["只有日期", "2026-09-30"],
    ["不存在的日期", "2026-02-30T10:00"],
    ["不存在的時間", "2026-09-30T25:00"],
    ["帶時區後綴", "2026-09-30T19:00Z"],
    ["亂字串", "tomorrow"],
  ])("無效輸入（%s）回傳 null", (_label, value) => {
    expect(parseTaipeiDateTime(value)).toBeNull();
  });

  it("非字串回傳 null", () => {
    expect(parseTaipeiDateTime(null)).toBeNull();
    expect(parseTaipeiDateTime(undefined)).toBeNull();
  });
});

describe("UTC epoch 毫秒轉台北時間的 datetime-local 值", () => {
  it("UTC 11:00 是台北 19:00", () => {
    expect(formatTaipeiDateTimeInput(Date.UTC(2026, 8, 30, 11, 0))).toBe("2026-09-30T19:00");
  });

  it("跨日：UTC 16:30 是台北隔天 00:30", () => {
    expect(formatTaipeiDateTimeInput(Date.UTC(2026, 8, 29, 16, 30))).toBe("2026-09-30T00:30");
  });

  it("與 parseTaipeiDateTime 互為反函數", () => {
    expect(parseTaipeiDateTime(formatTaipeiDateTimeInput(Date.UTC(2030, 0, 1, 5, 45)))).toBe(Date.UTC(2030, 0, 1, 5, 45));
  });
});
