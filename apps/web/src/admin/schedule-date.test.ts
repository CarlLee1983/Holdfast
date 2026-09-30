import { describe, expect, it } from "vitest";
import { adjacentWeekKey, getWeekDays, startOfWeekMonday, taipeiWeekRange } from "./schedule-date";
import { formatTaipeiDate, formatTaipeiTime } from "../catalog/taipei-time";

describe("schedule-date helpers", () => {
  it("startOfWeekMonday: 能將任意日期推算至該週的週一", () => {
    // 2026-09-30 是星期三
    expect(startOfWeekMonday("2026-09-30")).toBe("2026-09-28");
    // 2026-09-28 本身就是星期一
    expect(startOfWeekMonday("2026-09-28")).toBe("2026-09-28");
    // 2026-10-04 是星期日，該週週一應為 2026-09-28
    expect(startOfWeekMonday("2026-10-04")).toBe("2026-09-28");
  });

  it("adjacentWeekKey: 加減 7 天", () => {
    expect(adjacentWeekKey("2026-09-28", 1)).toBe("2026-10-05");
    expect(adjacentWeekKey("2026-09-28", -1)).toBe("2026-09-21");
  });

  it("getWeekDays: 回傳週一到週日 7 天的 dateKey 與資訊", () => {
    const days = getWeekDays("2026-09-28");
    expect(days).toHaveLength(7);
    expect(days[0]!.dateKey).toBe("2026-09-28");
    expect(days[0]!.dayOfWeek).toBe(1); // Mon
    expect(days[6]!.dateKey).toBe("2026-10-04");
    expect(days[6]!.dayOfWeek).toBe(7); // Sun
  });

  it("taipeiWeekRange: 產生整週 7 天 [from, to) 的時間戳", () => {
    const range = taipeiWeekRange("2026-09-28");
    // from 應該是 2026-09-28 00:00 台北時間
    expect(formatTaipeiDate(range.from)).toBe("2026/09/28（週一）");
    expect(formatTaipeiTime(range.from)).toBe("00:00");
    // to 應該是 2026-10-05 00:00 台北時間
    expect(formatTaipeiDate(range.to)).toBe("2026/10/05（週一）");
    expect(formatTaipeiTime(range.to)).toBe("00:00");

    expect(range.to - range.from).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
