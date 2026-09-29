import { describe, expect, it, vi } from "vitest";
import { handleHoldPost } from "./submit";

const URL_ = new URL("https://holdfast.example/?a=1");
const member = { memberId: "m1" };

function post(body: BodyInit = new URLSearchParams({ slotId: "3", seats: "2", idempotencyKey: "k" })) {
  return new Request(URL_, { method: "POST", body });
}

const fakeApp = (result: unknown) => ({ createHold: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, m: typeof member | null, request = post()) =>
  handleHoldPost({ member: m, request, app: app as never, url: URL_ });

describe("handleHoldPost", () => {
  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });

    expect(await run(app, null)).toEqual({ redirect: "/login?next=%2F%3Fa%3D1", status: 303 });
    expect(app.createHold).not.toHaveBeenCalled();
  });

  it("成功：303 到 /me?held=<id>，以會員編號與表單內容呼叫 App", async () => {
    const app = fakeApp({ ok: true, data: { id: 9 } });

    expect(await run(app, member)).toEqual({ redirect: "/me?held=9", status: 303 });
    expect(app.createHold).toHaveBeenCalledWith("m1", { slotId: 3, seats: 2, idempotencyKey: "k" });
  });

  it("業務失敗：409 與訊息", async () => {
    const app = fakeApp({ ok: false, reason: "insufficient_seats" });

    expect(await run(app, member)).toEqual({
      error: "剩餘名額不足，請改選其他時段或減少名額",
      status: 409,
    });
  });

  it("invalid_input：422，訊息後面附第一個欄位錯誤", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: { seats: ["名額至少為 1"] } });

    expect(await run(app, member)).toEqual({ error: "輸入有誤：名額至少為 1", status: 422 });
  });

  it("body 不是表單（formData() 丟錯）：422 輸入有誤，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });
    const request = new Request(URL_, {
      method: "POST",
      body: "not a form",
      headers: { "content-type": "text/plain" },
    });

    expect(await run(app, member, request)).toEqual({ error: "輸入有誤", status: 422 });
    expect(app.createHold).not.toHaveBeenCalled();
  });
});
