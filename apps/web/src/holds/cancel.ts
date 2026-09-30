import { toNumber } from "../shared/form-values";
import { handleMemberFormPost, type MemberPostOutcome } from "./member-post";
import { describeCancelFailure } from "./reasons";

/** 取消表單的 `intent` 欄位值；會員頁的表單都 POST 到 `/me`，靠它分辨。 */
export const CANCEL_INTENT = "cancel";

export type CancelPostOutcome = MemberPostOutcome;

interface CancelPostContext {
  member: { memberId: string } | null;
  form: FormData;
  app: Pick<Env["APP"], "cancelBooking">;
  url: URL;
}

/** 處理會員頁「取消訂位」表單的 POST。 */
export function handleCancelPost({ member, form, app, url }: CancelPostContext): Promise<CancelPostOutcome> {
  return handleMemberFormPost({
    member,
    id: toNumber(form.get("bookingId")),
    url,
    field: "bookingId",
    successParam: "cancelled",
    call: (memberId, input) => app.cancelBooking(memberId, input),
    describe: describeCancelFailure,
  });
}
