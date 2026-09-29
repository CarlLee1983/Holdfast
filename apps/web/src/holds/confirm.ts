import { handleMemberFormPost, type MemberPostOutcome } from "./member-post";
import { describeConfirmFailure } from "./reasons";

/** 確認表單的 `intent` 欄位值；會員頁的確認與取消都 POST 到 `/me`，靠它分辨。 */
export const CONFIRM_INTENT = "confirm";

export type ConfirmPostOutcome = MemberPostOutcome;

interface ConfirmPostContext {
  member: { memberId: string } | null;
  form: FormData;
  app: Pick<Env["APP"], "confirmHold">;
  url: URL;
}

/** 處理會員頁「確認」表單的 POST。 */
export function handleConfirmPost({ member, form, app, url }: ConfirmPostContext): Promise<ConfirmPostOutcome> {
  return handleMemberFormPost({
    member,
    form,
    url,
    field: "holdId",
    successParam: "confirmed",
    call: (memberId, input) => app.confirmHold(memberId, input),
    describe: describeConfirmFailure,
  });
}
