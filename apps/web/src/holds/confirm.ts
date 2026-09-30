import { loginUrl } from "../auth/member";
import { bookingPagePath } from "./booking-page";
import { parseRecordId } from "./record-id";
import { handleMemberFormPost, type MemberPostOutcome } from "./member-post";
import { describeConfirmFailure } from "./reasons";

export type ConfirmPostOutcome = MemberPostOutcome;

interface ConfirmPostContext {
  member: { memberId: string } | null;
  /** 網址 `/holds/:id` 的 id 原始字串；確認的對象由網址決定，不讀表單。 */
  holdId: string | undefined;
  app: Pick<Env["APP"], "confirmHold">;
  url: URL;
}

/**
 * 處理確認頁「確認訂位」表單的 POST：未登入導向登入；成功導向完成頁 `/bookings/<id>`；失敗回可顯示的訊息與狀態碼。
 * 確認的對象是網址上的保留，所以沒有 JavaScript 時確認的也一定是畫面上那一筆；id 不是正整數就當作輸入有誤，不呼叫 App。
 */
export async function handleConfirmPost({ member, holdId, app, url }: ConfirmPostContext): Promise<ConfirmPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };
  const id = parseRecordId(holdId);
  if (id === null) return { error: describeConfirmFailure("invalid_input"), status: 422 };

  return handleMemberFormPost({
    member,
    id,
    url,
    field: "holdId",
    successUrl: bookingPagePath,
    call: (memberId, input) => app.confirmHold(memberId, input),
    describe: describeConfirmFailure,
  });
}
