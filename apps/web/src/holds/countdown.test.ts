import { describe, expect, it } from "vitest";
import { formatCountdown, isCountdownExpired } from "./countdown";

describe("formatCountdown", () => {
  it("分與秒各補零到兩位", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
    expect(formatCountdown(9_000)).toBe("00:09");
  });

  it("超過 60 分鐘時分鐘數直接超過 60，不補小時", () => {
    expect(formatCountdown(75 * 60_000)).toBe("75:00");
    expect(formatCountdown(100 * 60_000 + 1_000)).toBe("100:01");
  });

  it("剛好 0 顯示 00:00", () => {
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("負值顯示 00:00", () => {
    expect(formatCountdown(-1)).toBe("00:00");
    expect(formatCountdown(-90_000)).toBe("00:00");
  });

  it("不足 1 秒向上取整，00:00 只在真正到期時出現", () => {
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(999)).toBe("00:01");
    expect(formatCountdown(1_000)).toBe("00:01");
    expect(formatCountdown(1_001)).toBe("00:02");
    expect(formatCountdown(60_001)).toBe("01:01");
  });
});

describe("isCountdownExpired", () => {
  it("剩餘為正數尚未到期，包含不足 1 毫秒的邊界", () => {
    expect(isCountdownExpired(1)).toBe(false);
  });

  it("剩餘剛好 0 視為到期", () => {
    expect(isCountdownExpired(0)).toBe(true);
  });

  it("負值視為到期", () => {
    expect(isCountdownExpired(-1)).toBe(true);
  });

  it("與 formatCountdown 一致：顯示 00:00 若且唯若已到期", () => {
    for (const ms of [-5, 0, 1, 500, 999, 1_000]) {
      expect(formatCountdown(ms) === "00:00").toBe(isCountdownExpired(ms));
    }
  });
});
