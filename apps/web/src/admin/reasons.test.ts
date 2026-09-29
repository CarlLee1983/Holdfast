import { describe, expect, it } from "vitest";
import { describeFailure } from "./reasons";

describe("管理 RPC 失敗原因轉成給管理者看的訊息", () => {
  it.each([
    ["resource_not_found", "找不到這個資源"],
    ["slot_overlaps", "與這個資源既有的時段重疊"],
  ])("%s 有具名的友善訊息", (reason, text) => {
    expect(describeFailure({ ok: false, reason })).toEqual({ message: text, fields: {} });
  });

  it("invalid_input 帶出欄位錯誤", () => {
    expect(
      describeFailure({ ok: false, reason: "invalid_input", fields: { name: ["名稱不可為空"] } }),
    ).toEqual({ message: "輸入有誤，請修正後再送出", fields: { name: ["名稱不可為空"] } });
  });

  it("未知的 reason 也不會丟例外，顯示通用訊息", () => {
    expect(describeFailure({ ok: false, reason: "something_new" }).message).toContain("something_new");
  });
});
