import { describe, expect, it, vi } from "vitest";
import { describeHoldFailure, holdFailureStatus } from "./reasons";

describe("建立保留失敗原因轉成訊息", () => {
  it.each([
    ["insufficient_seats", "剩餘名額不足，請改選其他時段或減少名額"],
    ["seats_per_hold_exceeded", "超過這個資源的單筆名額上限"],
    ["slot_started", "時段已開始，無法保留"],
    ["slot_overcommitted", "這個時段目前無法接受新的保留"],
    ["slot_not_found", "找不到這個時段"],
    ["idempotency_key_conflict", "這個保留請求已送出過，請重新整理頁面後再試"],
    ["invalid_input", "輸入有誤"],
  ])("%s 有具名的訊息", (reason, text) => {
    expect(describeHoldFailure(reason)).toBe(text);
  });

  it("未知的 reason 顯示通用訊息，代碼只寫進 console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const message = describeHoldFailure("something_new");

    expect(message).toBe("操作失敗，請稍後再試");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("something_new"));
    errorSpy.mockRestore();
  });

  it("invalid_input 是 422，其餘是 409", () => {
    expect(holdFailureStatus("invalid_input")).toBe(422);
    expect(holdFailureStatus("insufficient_seats")).toBe(409);
  });
});
