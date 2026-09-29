import { describe, expect, it, vi } from "vitest";
import { handleDeleteAccountPost } from "./delete";

const HTTPS_URL = new URL("https://holdfast.example/account/delete");
const HTTP_URL = new URL("http://localhost:4321/account/delete");
const member = { memberId: "m1" };

const fakeApp = (result: unknown) => ({ deleteAccount: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, m: typeof member | null, url = HTTPS_URL) =>
  handleDeleteAccountPost({ member: m, app: app as never, url });

describe("handleDeleteAccountPost", () => {
  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });

    expect(await run(app, null)).toEqual({
      redirect: "/login?next=%2Faccount%2Fdelete",
      status: 303,
      setCookies: [],
    });
    expect(app.deleteAccount).not.toHaveBeenCalled();
  });

  it("成功（https）：以會員編號呼叫 App，303 回首頁並清掉帶 __Secure- 前綴的 session cookie", async () => {
    const app = fakeApp({ ok: true, data: { cancelledBookings: 1, releasedHolds: 0 } });

    expect(await run(app, member)).toEqual({
      redirect: "/",
      status: 303,
      setCookies: ["__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"],
    });
    expect(app.deleteAccount).toHaveBeenCalledWith("m1");
  });

  it("成功（http，本機）：清掉沒有前綴的 session cookie", async () => {
    const outcome = await run(fakeApp({ ok: true, data: {} }), member, HTTP_URL);

    expect(outcome).toMatchObject({
      status: 303,
      setCookies: ["better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"],
    });
  });

  it("invalid_input：422，不清 cookie", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: {} });

    expect(await run(app, member)).toEqual({ error: "輸入有誤", status: 422 });
  });
});
