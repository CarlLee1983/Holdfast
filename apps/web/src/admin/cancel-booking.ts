import { toNumber, toText } from "../shared/form-values";
import { withFirstFieldDetail } from "../shared/reasons";
import { describeFailure } from "./reasons";

export type CancelBookingPostOutcome =
  | { redirect: string; status: 303 }
  | { error: string; status: 403 | 404 | 409 | 422 };

interface CancelBookingPostContext {
  jwt: string;
  request: Request;
  app: {
    cancelBookingForAdmin: (jwt: string, input: { slotId: number; bookingId: number; reason: string }) => Promise<
      | { ok: true; data: { id: number } }
      | { ok: false; reason: string; fields?: Record<string, string[]> }
    >;
  };
  /** 時段詳情頁固定帶入；日程表沒有固定時段，從表單的 slotId 讀。 */
  slotId?: number;
  /** 成功後的導向位址，由頁面在伺服器端決定。 */
  successUrl: (bookingId: number) => string;
}

const FAILURE_STATUS: Record<string, 403 | 404 | 409 | 422 | undefined> = {
  unauthorized: 403,
  invalid_input: 422,
  booking_not_found: 404,
  slot_started: 409,
};

/** 時段詳情頁與日程表共用；成功後的導向位址一律由 `successUrl` 產生，避免重送 POST 或由表單控制導向。 */
export async function handleCancelBookingPost({
  jwt,
  request,
  app,
  slotId,
  successUrl,
}: CancelBookingPostContext): Promise<CancelBookingPostOutcome> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: describeFailure({ ok: false, reason: "invalid_input" }).message, status: 422 };
  }

  const bookingId = toNumber(form.get("bookingId"));
  const result = await app.cancelBookingForAdmin(jwt, {
    slotId: slotId ?? toNumber(form.get("slotId")),
    bookingId,
    // 交給 App 修剪與驗證長度；沒填或不是文字都當作空字串
    reason: toText(form.get("reason")),
  });
  if (result.ok) {
    return { redirect: successUrl(result.data.id), status: 303 };
  }

  const message = describeFailure(result);
  return {
    error: result.reason === "invalid_input" ? withFirstFieldDetail(message.message, result.fields ?? {}) : message.message,
    status: FAILURE_STATUS[result.reason] ?? 404,
  };
}
