import { describe, expect, it } from "vitest";
import { parseDate, parseSeats, parseSlotId } from "./params";

describe("parseSeats", () => {
  it("合法整數（含邊界 1 與 max）照用", () => {
    expect(parseSeats("1", 10)).toBe(1);
    expect(parseSeats("4", 10)).toBe(4);
    expect(parseSeats("10", 10)).toBe(10);
  });

  it("沒帶參數時預設 2 位", () => {
    expect(parseSeats(null, 10)).toBe(2);
  });

  it("超出範圍退回預設：0、負數、max + 1", () => {
    expect(parseSeats("0", 10)).toBe(2);
    expect(parseSeats("-1", 10)).toBe(2);
    expect(parseSeats("11", 10)).toBe(2);
  });

  it("不是整數退回預設：小數、空字串、文字、帶空白或正負號", () => {
    for (const raw of ["2.5", "", "abc", " 3", "+3", "3 ", "1e1", "03"]) {
      expect(parseSeats(raw, 10)).toBe(2);
    }
  });

  it("max 只有 1 時預設為 1", () => {
    expect(parseSeats(null, 1)).toBe(1);
    expect(parseSeats("2", 1)).toBe(1);
  });

  it("沒有資源（max 為 0）時任何值都退回 2", () => {
    expect(parseSeats("1", 0)).toBe(2);
    expect(parseSeats(null, 0)).toBe(2);
  });
});

describe("parseDate", () => {
  const options = [
    { value: "2026-09-30", disabled: true },
    { value: "2026-10-01", disabled: false },
    { value: "2026-10-02", disabled: false },
  ];

  it("可選的日期選項照用", () => {
    expect(parseDate("2026-10-02", options, "2026-09-30")).toBe("2026-10-02");
  });

  it("不能選的日期退回第一個可選的日期", () => {
    expect(parseDate("2026-09-30", options, "2026-09-30")).toBe("2026-10-01");
  });

  it("不在選項內或格式不對退回第一個可選的日期", () => {
    expect(parseDate("2026-12-25", options, "2026-09-30")).toBe("2026-10-01");
    expect(parseDate("10/2", options, "2026-09-30")).toBe("2026-10-01");
    expect(parseDate(null, options, "2026-09-30")).toBe("2026-10-01");
  });

  it("全部都不能選時用今天", () => {
    const allDisabled = options.map((o) => ({ ...o, disabled: true }));
    expect(parseDate("2026-10-01", allDisabled, "2026-09-30")).toBe("2026-09-30");
  });

  it("沒有任何選項時用今天", () => {
    expect(parseDate(null, [], "2026-09-30")).toBe("2026-09-30");
  });
});

describe("parseSlotId", () => {
  it("正整數轉成數字", () => {
    expect(parseSlotId("1")).toBe(1);
    expect(parseSlotId("42")).toBe(42);
  });

  it("沒帶、0、負數、小數、文字、前導零、超出安全整數都當作沒選", () => {
    for (const raw of [null, "", "0", "-3", "1.5", "abc", "007", " 5", "9007199254740993"]) {
      expect(parseSlotId(raw)).toBeNull();
    }
  });
});
