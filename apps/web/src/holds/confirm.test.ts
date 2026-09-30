import { describe, expect, it, vi } from "vitest";
import { handleConfirmPost } from "./confirm";

const URL_ = new URL("https://holdfast.example/holds/9");
const member = { memberId: "m1" };

const fakeApp = (result: unknown) => ({ confirmHold: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, m: typeof member | null, holdId: string | undefined) =>
  handleConfirmPost({ member: m, holdId, app: app as never, url: URL_ });

describe("handleConfirmPost", () => {
  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });

    expect(await run(app, null, "9")).toEqual({ redirect: "/login?next=%2Fholds%2F9", status: 303 });
    expect(app.confirmHold).not.toHaveBeenCalled();
  });

  it("成功：303 到 /me?confirmed=<id>，以會員編號與網址上的保留編號呼叫 App", async () => {
    const app = fakeApp({ ok: true, data: { id: 9 } });

    expect(await run(app, member, "9")).toEqual({ redirect: "/me?confirmed=9", status: 303 });
    expect(app.confirmHold).toHaveBeenCalledWith("m1", { holdId: 9 });
  });

  it.each(["", "abc", "0", "-9", "09", "9.5", "9 ", undefined])(
    "網址上的編號不是正整數（%j）：422 輸入有誤，不呼叫 App",
    async (holdId) => {
      const app = fakeApp({ ok: true });

      expect(await run(app, member, holdId)).toEqual({ error: "輸入有誤", status: 422 });
      expect(app.confirmHold).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["hold_expired", "保留已過期，無法確認，請重新保留"],
    ["hold_not_found", "找不到這筆保留"],
  ])("%s：409 與具名訊息", async (reason, error) => {
    expect(await run(fakeApp({ ok: false, reason }), member, "9")).toEqual({ error, status: 409 });
  });

  it("App 回報 invalid_input：422，訊息後面附第一個欄位錯誤", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: { holdId: ["保留編號無效"] } });

    expect(await run(app, member, "9")).toEqual({ error: "輸入有誤：保留編號無效", status: 422 });
  });
});
