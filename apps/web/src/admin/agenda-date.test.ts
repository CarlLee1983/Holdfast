import { describe, expect, it } from "vitest";
import { DAY_MS } from "../catalog/taipei-time";
import { adjacentDateKey, parseDateParam, parseResourceParam, taipeiDayRange } from "./agenda-date";

const TODAY = "2026-09-30";

describe("parseDateParam", () => {
  it("合法日期原樣回傳", () => {
    expect(parseDateParam("2026-10-05", TODAY)).toBe("2026-10-05");
    expect(parseDateParam("2028-02-29", TODAY)).toBe("2028-02-29");
  });

  it.each([null, "", "abc", "2026-02-30", "2026-13-01", "2026-9-30", "2026-09-30x", "2027-02-29", "0000-00-00"])(
    "缺少或非法（%s）退回今天",
    (raw) => {
      expect(parseDateParam(raw, TODAY)).toBe(TODAY);
    },
  );
});

describe("taipeiDayRange", () => {
  it("台北一天是 UTC 前一天 16:00 起的 24 小時", () => {
    const { from, to } = taipeiDayRange("2026-09-30");
    expect(from).toBe(Date.UTC(2026, 8, 29, 16));
    expect(to - from).toBe(DAY_MS);
  });

  it("台北前一天 23:59（UTC 15:59）在區間外", () => {
    const { from } = taipeiDayRange("2026-09-30");
    expect(Date.UTC(2026, 8, 29, 15, 59)).toBeLessThan(from);
  });

  it("台北 23:30 在當天內，隔天 00:00 在區間外（半開）", () => {
    const { from, to } = taipeiDayRange("2026-09-30");
    const at2330 = Date.UTC(2026, 8, 30, 15, 30);
    const nextMidnight = Date.UTC(2026, 8, 30, 16);
    expect(at2330 >= from && at2330 < to).toBe(true);
    expect(nextMidnight >= to).toBe(true);
  });
});

describe("adjacentDateKey", () => {
  it("前後一天，含月與年的進位", () => {
    expect(adjacentDateKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(adjacentDateKey("2026-10-01", -1)).toBe("2026-09-30");
    expect(adjacentDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(adjacentDateKey("2027-01-01", -1)).toBe("2026-12-31");
    expect(adjacentDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("parseResourceParam", () => {
  it("正整數轉成數字", () => {
    expect(parseResourceParam("3")).toBe(3);
  });

  it.each([null, "", "0", "-1", "1.5", "abc", "1e3", "03x", "99999999999999999999"])("非正整數（%s）是 undefined", (raw) => {
    expect(parseResourceParam(raw)).toBeUndefined();
  });
});
