import { describe, expect, it } from "vitest";
import { formatTaipeiDate, formatTaipeiTime } from "./taipei-time";

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
