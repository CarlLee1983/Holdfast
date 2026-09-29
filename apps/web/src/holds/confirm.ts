import { loginUrl } from "../auth/member";
import { toNumber } from "../shared/form-values";
import { describeConfirmFailure, holdFailureStatus } from "./reasons";

export type ConfirmPostOutcome =
  | { redirect: string; status: 303 }
  | { error: string; status: 409 | 422 };

interface ConfirmPostContext {
  member: { memberId: string } | null;
  request: Request;
  app: Pick<Env["APP"], "confirmHold">;
  url: URL;
}

/** 處理會員頁「確認」表單的 POST：未登入導向登入；成功導向會員頁；失敗回可顯示的訊息與狀態碼。 */
export async function handleConfirmPost({
  member,
  request,
  app,
  url,
}: ConfirmPostContext): Promise<ConfirmPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: describeConfirmFailure("invalid_input"), status: 422 };
  }

  const result = await app.confirmHold(member.memberId, { holdId: toNumber(form.get("holdId")) });
  if (result.ok) return { redirect: `/me?confirmed=${result.data.id}`, status: 303 };

  let error = describeConfirmFailure(result.reason);
  if (result.reason === "invalid_input") {
    const detail = Object.values(result.fields).flat()[0];
    if (detail) error = `${error}：${detail}`;
  }
  return { error, status: holdFailureStatus(result.reason) };
}
