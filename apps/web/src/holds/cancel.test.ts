import { describe, expect, it, vi } from "vitest";
import { handleCancelPost } from "./cancel";

const URL_ = new URL("https://holdfast.example/me");
const member = { memberId: "m1" };

const formOf = (fields: Record<string, string> = { intent: "cancel", bookingId: "9" }) =>
  new URLSearchParams(fields) as unknown as FormData;

const fakeApp = (result: unknown) => ({ cancelBooking: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, m: typeof member | null, form = formOf()) =>
  handleCancelPost({ member: m, form, app: app as never, url: URL_ });

describe("handleCancelPost", () => {
  it("訪客：303 導向登入，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });

    expect(await run(app, null)).toEqual({ redirect: "/login?next=%2Fme", status: 303 });
    expect(app.cancelBooking).not.toHaveBeenCalled();
  });

  it("成功：303 到 /me?cancelled=<id>，以會員編號與訂位編號呼叫 App", async () => {
    const app = fakeApp({ ok: true, data: { id: 9 } });

    expect(await run(app, member)).toEqual({ redirect: "/me?cancelled=9", status: 303 });
    expect(app.cancelBooking).toHaveBeenCalledWith("m1", { bookingId: 9 });
  });

  it.each([
    ["cancellation_cutoff_passed", "已過取消截止時間，無法自行取消"],
    ["booking_not_found", "找不到這筆訂位"],
  ])("%s：409 與具名訊息", async (reason, error) => {
    expect(await run(fakeApp({ ok: false, reason }), member)).toEqual({ error, status: 409 });
  });

  it("invalid_input：422", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: { bookingId: ["訂位編號無效"] } });

    expect(await run(app, member)).toEqual({ error: "輸入有誤：訂位編號無效", status: 422 });
  });
});
