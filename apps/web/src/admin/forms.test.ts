import { describe, expect, it } from "vitest";
import { formToRecord, resourceFormToInput, slotCapacityFormToInput, slotFormToInput, slotIdFormToInput, slotTimeFormToInput } from "./forms";

const form = (entries: Record<string, string>) => new URLSearchParams(entries);

describe("資源表單轉 RPC 輸入", () => {
  it("欄位轉成數字；保留期限留空就省略，讓 App 套預設值", () => {
    expect(
      resourceFormToInput(
        form({ name: "大廳", holdTtlSeconds: "", seatsPerHold: "4", cancellationCutoffSeconds: "7200" }),
      ),
    ).toEqual({ name: "大廳", seatsPerHold: 4, cancellationCutoffSeconds: 7200, description: "" });
  });

  it("說明原樣帶上（長度由 App 驗證）；沒有這個欄位時為空字串", () => {
    const base = { name: "大廳", seatsPerHold: "4", cancellationCutoffSeconds: "0" };
    expect(resourceFormToInput(form({ ...base, description: "長桌" })).description).toBe("長桌");
    expect(resourceFormToInput(form(base)).description).toBe("");
  });

  it("有填保留期限就帶上", () => {
    expect(
      resourceFormToInput(
        form({ name: "包廂", holdTtlSeconds: "300", seatsPerHold: "6", cancellationCutoffSeconds: "0" }),
      ),
    ).toMatchObject({ holdTtlSeconds: 300, cancellationCutoffSeconds: 0 });
  });

  it("不是數字的欄位轉成 NaN，交給 App 驗證並回報欄位錯誤（Web 不自己判斷規則）", () => {
    const input = resourceFormToInput(
      form({ name: "x", seatsPerHold: "abc", cancellationCutoffSeconds: "" }),
    );
    expect(input.seatsPerHold).toBeNaN();
    expect(input.cancellationCutoffSeconds).toBeNaN();
  });

  it("帶 id 時（修改）一併轉出，並要求保留期限", () => {
    expect(
      resourceFormToInput(
        form({ name: "大廳", holdTtlSeconds: "600", seatsPerHold: "4", cancellationCutoffSeconds: "0" }),
        3,
      ),
    ).toEqual({ id: 3, name: "大廳", holdTtlSeconds: 600, seatsPerHold: 4, cancellationCutoffSeconds: 0, description: "" });
  });
});

describe("時段表單轉 RPC 輸入", () => {
  it("台北時間轉成 UTC epoch 毫秒", () => {
    expect(
      slotFormToInput(
        form({ startsAt: "2026-09-30T19:00", endsAt: "2026-09-30T21:00", capacity: "20" }),
        5,
      ),
    ).toEqual({
      resourceId: 5,
      startsAt: Date.UTC(2026, 8, 30, 11),
      endsAt: Date.UTC(2026, 8, 30, 13),
      capacity: 20,
    });
  });

  it("時間格式無效時轉成 NaN，由 App 回報欄位錯誤", () => {
    const input = slotFormToInput(form({ startsAt: "", endsAt: "bad", capacity: "1" }), 1);
    expect(input.startsAt).toBeNaN();
    expect(input.endsAt).toBeNaN();
  });
});

describe("時段容量與刪除表單轉 RPC 輸入", () => {
  it("容量表單帶時段編號與容量", () => {
    expect(slotCapacityFormToInput(form({ slotId: "7", capacity: "12" }))).toEqual({ slotId: 7, capacity: 12 });
  });

  it("容量或編號不是數字時轉成 NaN，由 App 回報欄位錯誤", () => {
    const input = slotCapacityFormToInput(form({ slotId: "", capacity: "abc" }));
    expect(input.slotId).toBeNaN();
    expect(input.capacity).toBeNaN();
  });

  it("刪除表單只帶時段編號", () => {
    expect(slotIdFormToInput(form({ slotId: "7", capacity: "12" }))).toEqual({ slotId: 7 });
  });
});

describe("修改時段時間表單轉 RPC 輸入", () => {
  it("台北時間轉成 UTC epoch 毫秒", () => {
    expect(slotTimeFormToInput(form({ slotId: "7", startsAt: "2026-09-30T19:00", endsAt: "2026-09-30T20:30" }))).toEqual({
      slotId: 7,
      startsAt: Date.UTC(2026, 8, 30, 11, 0),
      endsAt: Date.UTC(2026, 8, 30, 12, 30),
    });
  });

  it("時間格式無效時轉成 NaN，由 App 回報欄位錯誤", () => {
    const input = slotTimeFormToInput(form({ slotId: "7", startsAt: "", endsAt: "bad" }));
    expect(input.startsAt).toBeNaN();
    expect(input.endsAt).toBeNaN();
  });
});

describe("表單轉字串記錄（送出失敗時回填欄位用）", () => {
  it("只保留字串值，略過檔案欄位", () => {
    const data = new FormData();
    data.set("name", "大廳");
    data.set("upload", new File(["x"], "x.txt"));

    expect(formToRecord(data)).toEqual({ name: "大廳" });
  });
});
