import { describe, expect, it, vi } from "vitest";
import { describeCancelFailure, describeConfirmFailure, describeHoldFailure, holdFailureStatus } from "./reasons";

describe("建立保留失敗原因轉成訊息", () => {
  it.each([
    ["insufficient_seats", "剩餘位數不足，請改選其他時段或減少人數"],
    ["seats_per_hold_exceeded", "人數超過這個座位線上可訂的上限"],
    ["slot_started", "時段已開始，無法保留"],
    ["already_in_slot", "你在這個時段已有有效的保留或訂位"],
    ["active_hold_limit_reached", "你持有的有效保留已達上限，請先確認或等待到期後再保留"],
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
    expect(holdFailureStatus("already_in_slot")).toBe(409);
    expect(holdFailureStatus("active_hold_limit_reached")).toBe(409);
  });
});

describe("確認保留失敗原因轉成訊息", () => {
  it.each([
    ["hold_expired", "保留已過期，無法確認，請重新保留"],
    ["hold_not_found", "找不到這筆保留"],
    ["booking_cancelled", "這筆訂位已取消"],
    ["invalid_input", "輸入有誤"],
  ])("%s 有具名的訊息", (reason, text) => {
    expect(describeConfirmFailure(reason)).toBe(text);
  });
});

describe("取消訂位失敗原因轉成訊息", () => {
  it.each([
    ["cancellation_cutoff_passed", "已過取消截止時間，無法自行取消"],
    ["booking_not_found", "找不到這筆訂位"],
    ["invalid_input", "輸入有誤"],
  ])("%s 有具名的訊息", (reason, text) => {
    expect(describeCancelFailure(reason)).toBe(text);
  });
});
