import { describe, expect, it, vi } from "vitest";
import { handleConfirmPost } from "./confirm";

const URL_ = new URL("https://holdfast.example/me");
const member = { memberId: "m1" };

const post = (body: BodyInit = new URLSearchParams({ holdId: "9" })) =>
  new Request(URL_, { method: "POST", body });

const fakeApp = (result: unknown) => ({ confirmHold: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, m: typeof member | null, request = post()) =>
  handleConfirmPost({ member: m, request, app: app as never, url: URL_ });

describe("handleConfirmPost", () => {
  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });

    expect(await run(app, null)).toEqual({ redirect: "/login?next=%2Fme", status: 303 });
    expect(app.confirmHold).not.toHaveBeenCalled();
  });

  it("成功：303 到 /me?confirmed=<id>，以會員編號與保留編號呼叫 App", async () => {
    const app = fakeApp({ ok: true, data: { id: 9 } });

    expect(await run(app, member)).toEqual({ redirect: "/me?confirmed=9", status: 303 });
    expect(app.confirmHold).toHaveBeenCalledWith("m1", { holdId: 9 });
  });

  it.each([
    ["hold_expired", "保留已過期，無法確認，請重新保留"],
    ["hold_not_found", "找不到這筆保留"],
  ])("%s：409 與具名訊息", async (reason, error) => {
    expect(await run(fakeApp({ ok: false, reason }), member)).toEqual({ error, status: 409 });
  });

  it("invalid_input：422", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: { holdId: ["保留編號無效"] } });

    expect(await run(app, member)).toEqual({ error: "輸入有誤：保留編號無效", status: 422 });
  });

  it("body 不是表單：422，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });
    const request = new Request(URL_, { method: "POST", body: "x", headers: { "content-type": "text/plain" } });

    expect(await run(app, member, request)).toEqual({ error: "輸入有誤", status: 422 });
    expect(app.confirmHold).not.toHaveBeenCalled();
  });
});
