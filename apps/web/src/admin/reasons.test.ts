import { describe, expect, it, vi } from "vitest";
import { describeFailure, failureStatus } from "./reasons";

describe("管理 RPC 失敗原因轉成給管理者看的訊息", () => {
  it.each([
    ["resource_not_found", "找不到這個資源"],
    ["slot_overlaps", "與其他時段重疊"],
    ["slot_not_found", "找不到這個時段"],
    ["slot_in_use", "時段仍有保留或訂位紀錄（過期或已釋放的保留除外）"],
    ["member_not_found", "找不到這位會員"],
    ["slot_started", "時段已開始，無法取消"],
  ])("%s 有具名的友善訊息", (reason, text) => {
    expect(describeFailure({ ok: false, reason })).toEqual({ message: text, fields: {} });
  });

  it("invalid_input 帶出欄位錯誤", () => {
    expect(
      describeFailure({ ok: false, reason: "invalid_input", fields: { name: ["名稱不可為空"] } }),
    ).toEqual({ message: "輸入有誤，請修正後再送出", fields: { name: ["名稱不可為空"] } });
  });

  it("未知的 reason 顯示通用訊息，不洩漏內部代碼；代碼只寫進 console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const failure = describeFailure({ ok: false, reason: "something_new" });

    expect(failure).toEqual({ message: "操作失敗，請稍後再試", fields: {} });
    expect(failure.message).not.toContain("something_new");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("something_new"));
    errorSpy.mockRestore();
  });
});

describe("failureStatus", () => {
  it.each([
    ["unauthorized", 403],
    ["invalid_input", 422],
    ["member_not_found", 404],
    ["booking_not_found", 404],
    ["slot_started", 409],
  ])("%s 對應 %i", (reason, status) => {
    expect(failureStatus(reason)).toBe(status);
  });

  it("沒列出的原因用 fallback，預設 500", () => {
    expect(failureStatus("something_new")).toBe(500);
    expect(failureStatus("something_new", 404)).toBe(404);
  });
});
