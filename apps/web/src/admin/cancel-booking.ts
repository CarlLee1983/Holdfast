import { toNumber } from "../shared/form-values";
import { withFirstFieldDetail } from "../shared/reasons";
import { describeFailure } from "./reasons";

export type CancelBookingPostOutcome =
  | { redirect: string; status: 303 }
  | { error: string; status: 403 | 404 | 422 };

interface CancelBookingPostContext {
  jwt: string;
  request: Request;
  app: {
    cancelBookingForAdmin: (jwt: string, input: { slotId: number; bookingId: number }) => Promise<
      | { ok: true; data: { id: number } }
      | { ok: false; reason: string; fields?: Record<string, string[]> }
    >;
  };
  slotId: number;
}

/** 成功後固定回本時段頁，避免重送 POST 或由表單控制導向位址。 */
export async function handleCancelBookingPost({
  jwt,
  request,
  app,
  slotId,
}: CancelBookingPostContext): Promise<CancelBookingPostOutcome> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: describeFailure({ ok: false, reason: "invalid_input" }).message, status: 422 };
  }

  const bookingId = toNumber(form.get("bookingId"));
  const result = await app.cancelBookingForAdmin(jwt, { slotId, bookingId });
  if (result.ok) {
    return { redirect: `/admin/slots/${slotId}?cancelled=${result.data.id}`, status: 303 };
  }

  const message = describeFailure(result);
  return {
    error: result.reason === "invalid_input" ? withFirstFieldDetail(message.message, result.fields ?? {}) : message.message,
    status: result.reason === "unauthorized" ? 403 : result.reason === "invalid_input" ? 422 : 404,
  };
}
