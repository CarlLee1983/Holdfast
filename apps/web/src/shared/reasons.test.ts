import { describe, expect, it, vi } from "vitest";
import { describeReason } from "./reasons";

describe("describeReason", () => {
  it("有具名訊息就回傳", () => {
    expect(describeReason({ a: "甲" }, "a", "測試")).toBe("甲");
  });

  it("查不到回通用訊息，代碼與操作名稱只寫進 console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(describeReason({}, "zzz", "測試")).toBe("操作失敗，請稍後再試");
    expect(errorSpy).toHaveBeenCalledWith("未預期的測試失敗原因：zzz");
    errorSpy.mockRestore();
  });
});
