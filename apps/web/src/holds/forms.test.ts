import { describe, expect, it } from "vitest";
import { holdFormToInput } from "./forms";

const form = (entries: Record<string, string>) => new URLSearchParams(entries);

describe("保留表單轉 RPC 輸入", () => {
  it("欄位轉成數字，冪等鍵原樣帶上", () => {
    expect(holdFormToInput(form({ slotId: "7", seats: "2", idempotencyKey: "abc" }))).toEqual({
      slotId: 7,
      seats: 2,
      idempotencyKey: "abc",
    });
  });

  it("空白或不是數字的欄位轉成 NaN，交給 App 驗證", () => {
    const input = holdFormToInput(form({ slotId: "x", seats: " ", idempotencyKey: "k" }));
    expect(input.slotId).toBeNaN();
    expect(input.seats).toBeNaN();
  });

  it("缺少的冪等鍵轉成空字串（由 App 拒絕）", () => {
    expect(holdFormToInput(form({ slotId: "1", seats: "1" })).idempotencyKey).toBe("");
  });
});
