import { describe, expect, it } from "vitest";
import { parseRecordId } from "./record-id";

describe("parseRecordId", () => {
  it("正整數的標準寫法轉成數字", () => {
    expect(parseRecordId("7")).toBe(7);
    expect(parseRecordId("12345")).toBe(12345);
  });

  it.each(["", "abc", "0", "-7", "07", "7.0", "7 ", "+7", "9007199254740993", undefined])("非法（%j）：null", (raw) => {
    expect(parseRecordId(raw)).toBeNull();
  });
});
