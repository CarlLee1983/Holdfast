import { describe, expect, it } from "vitest";
import { heldNotice } from "./held-notice";

const holds = [{ id: 4 }, { id: 5 }];

describe("heldNotice", () => {
  it("沒帶參數：不提示", () => {
    expect(heldNotice(holds, null)).toBeNull();
  });

  it("id 在有效保留裡：成功", () => {
    expect(heldNotice(holds, "5")).toEqual({ kind: "held", hold: { id: 5 } });
  });

  it.each(["9", "abc", ""])("找不到（%s）：missing", (param) => {
    expect(heldNotice(holds, param)).toEqual({ kind: "missing" });
  });
});
