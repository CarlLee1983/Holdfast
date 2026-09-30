import { describe, expect, it } from "vitest";
import { holdPageState, reselectUrl } from "./hold-page";

const holds = [
  { id: 7, slotId: 1, seats: 2, startsAt: Date.UTC(2026, 9, 1, 3) },
  { id: 8, slotId: 3, seats: 4, startsAt: Date.UTC(2026, 9, 1, 11) },
];

describe("holdPageState", () => {
  it("自己的有效保留：回傳保留", () => {
    expect(holdPageState(holds, "7")).toEqual({ kind: "active", hold: holds[0] });
    expect(holdPageState(holds, "8")).toEqual({ kind: "active", hold: holds[1] });
  });

  it("編號不在傳入的有效保留清單裡：unavailable（清單只含該會員自己的保留，擁有權由 E2E 驗證）", () => {
    expect(holdPageState(holds, "99")).toEqual({ kind: "unavailable" });
    expect(holdPageState([], "7")).toEqual({ kind: "unavailable" });
  });

  it.each(["", "abc", "0", "-7", "07", "7.0", "7 ", "+7", "1e1", "9007199254740993"])(
    "編號格式不合法（%j）：unavailable",
    (raw) => {
      expect(holdPageState(holds, raw)).toEqual({ kind: "unavailable" });
    },
  );

  it("網址沒有編號：unavailable", () => {
    expect(holdPageState(holds, undefined)).toEqual({ kind: "unavailable" });
  });
});

describe("reselectUrl", () => {
  it("帶上人數與時段的台北日期", () => {
    expect(reselectUrl({ seats: 4, startsAt: Date.UTC(2026, 9, 1, 3) })).toBe("/?seats=4&date=2026-10-01");
  });

  it("以台北日期計：UTC 16:00 之後已是台北隔天", () => {
    expect(reselectUrl({ seats: 2, startsAt: Date.UTC(2026, 9, 1, 16) })).toBe("/?seats=2&date=2026-10-02");
  });
});
