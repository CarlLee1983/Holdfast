import { describe, expect, it, vi } from "vitest";
import { handleMePost } from "./me-post";

const URL_ = new URL("https://holdfast.example/me");
const member = { memberId: "m1" };

const post = (fields: Record<string, string>) =>
  new Request(URL_, { method: "POST", body: new URLSearchParams(fields) });

const fakeApp = () => ({
  confirmHold: vi.fn().mockResolvedValue({ ok: true, data: { id: 9 } }),
  cancelBooking: vi.fn().mockResolvedValue({ ok: true, data: { id: 7 } }),
});
const run = (app: ReturnType<typeof fakeApp>, request: Request, m: typeof member | null = member) =>
  handleMePost({ member: m, request, app: app as never, url: URL_ });

describe("handleMePost", () => {
  it("intent=confirm：分派給確認", async () => {
    const app = fakeApp();

    expect(await run(app, post({ intent: "confirm", holdId: "9" }))).toEqual({ redirect: "/me?confirmed=9", status: 303 });
    expect(app.confirmHold).toHaveBeenCalledWith("m1", { holdId: 9 });
    expect(app.cancelBooking).not.toHaveBeenCalled();
  });

  it("intent=cancel：分派給取消", async () => {
    const app = fakeApp();

    expect(await run(app, post({ intent: "cancel", bookingId: "7" }))).toEqual({
      redirect: "/me?cancelled=7",
      status: 303,
    });
    expect(app.cancelBooking).toHaveBeenCalledWith("m1", { bookingId: 7 });
    expect(app.confirmHold).not.toHaveBeenCalled();
  });

  it.each([
    ["缺少 intent", { holdId: "9" }],
    ["未知的 intent", { intent: "delete", holdId: "9" }],
  ])("%s：422，不呼叫 App", async (_label, fields) => {
    const app = fakeApp();

    expect(await run(app, post(fields))).toEqual({ error: "輸入有誤", status: 422 });
    expect(app.confirmHold).not.toHaveBeenCalled();
    expect(app.cancelBooking).not.toHaveBeenCalled();
  });

  it("body 不是表單：422，不呼叫 App", async () => {
    const app = fakeApp();
    const request = new Request(URL_, { method: "POST", body: "x", headers: { "content-type": "text/plain" } });

    expect(await run(app, request)).toEqual({ error: "輸入有誤", status: 422 });
    expect(app.confirmHold).not.toHaveBeenCalled();
  });

  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp();

    expect(await run(app, post({ intent: "cancel", bookingId: "7" }), null)).toEqual({
      redirect: "/login?next=%2Fme",
      status: 303,
    });
    expect(app.cancelBooking).not.toHaveBeenCalled();
  });
});
