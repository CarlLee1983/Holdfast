import { describe, expect, it, vi } from "vitest";
import { handleCancelBookingPost } from "./cancel-booking";

const url = "https://holdfast.example/admin/slots/7";
const post = (body: BodyInit = new URLSearchParams({ bookingId: "23" })) =>
  new Request(url, { method: "POST", body });
const fakeApp = (result: unknown) => ({ cancelBookingForAdmin: vi.fn().mockResolvedValue(result) });
const run = (app: ReturnType<typeof fakeApp>, request = post()) =>
  handleCancelBookingPost({ jwt: "access-jwt", request, app: app as never, slotId: 7, successUrl });
const successUrl = (bookingId: number) => `/admin/slots/7?cancelled=${bookingId}`;

describe("handleCancelBookingPost", () => {
  it("成功後 303 回固定時段頁，並傳送 JWT 與訂位編號", async () => {
    const app = fakeApp({ ok: true, data: { id: 23, slotId: 7, seats: 2 } });

    expect(await run(app)).toEqual({ redirect: "/admin/slots/7?cancelled=23", status: 303 });
    expect(app.cancelBookingForAdmin).toHaveBeenCalledWith("access-jwt", { slotId: 7, bookingId: 23, reason: "" });
  });

  it("傳送表單的取消原因，原樣交給 App 驗證與修剪", async () => {
    const app = fakeApp({ ok: true, data: { id: 23, slotId: 7, seats: 2 } });

    await run(app, post(new URLSearchParams({ bookingId: "23", reason: "  店休  " })));
    expect(app.cancelBookingForAdmin).toHaveBeenCalledWith("access-jwt", { slotId: 7, bookingId: 23, reason: "  店休  " });
  });

  it("沒有固定 slotId 時（日程表）從表單讀，導向位址仍由 successUrl 決定", async () => {
    const app = fakeApp({ ok: true, data: { id: 23, slotId: 9, seats: 2 } });
    const request = post(new URLSearchParams({ bookingId: "23", slotId: "9", redirect: "https://evil.example" }));

    expect(
      await handleCancelBookingPost({
        jwt: "access-jwt",
        request,
        app: app as never,
        successUrl: (id) => `/admin?date=2030-01-01&cancelled=${id}`,
      }),
    ).toEqual({ redirect: "/admin?date=2030-01-01&cancelled=23", status: 303 });
    expect(app.cancelBookingForAdmin).toHaveBeenCalledWith("access-jwt", { slotId: 9, bookingId: 23, reason: "" });
  });

  it.each([
    ["unauthorized", 403, "操作失敗，請稍後再試"],
    ["booking_not_found", 404, "找不到這筆訂位"],
    ["slot_started", 409, "時段已開始，無法取消"],
  ])("%s 對應狀態碼與訊息", async (reason, status, error) => {
    const app = fakeApp({ ok: false, reason });
    const outcome = await run(app);
    expect(outcome).toEqual({ error, status });
    expect("redirect" in outcome).toBe(false);
  });

  it("無效訂位編號由 App 驗證，顯示欄位錯誤", async () => {
    const app = fakeApp({ ok: false, reason: "invalid_input", fields: { bookingId: ["訂位編號無效"] } });

    expect(await run(app, post(new URLSearchParams()))).toEqual({
      error: "輸入有誤，請修正後再送出：訂位編號無效",
      status: 422,
    });
    expect(app.cancelBookingForAdmin).toHaveBeenCalledWith("access-jwt", { slotId: 7, bookingId: Number.NaN, reason: "" });
  });

  it("非表單 body 回 422，不呼叫 App", async () => {
    const app = fakeApp({ ok: true });
    const request = post("x");
    request.headers.set("content-type", "text/plain");

    expect(await run(app, request)).toEqual({ error: "輸入有誤，請修正後再送出", status: 422 });
    expect(app.cancelBookingForAdmin).not.toHaveBeenCalled();
  });
});
