import { loginUrl } from "../auth/member";
import { holdFormToInput } from "./forms";
import { describeHoldFailure, holdFailureStatus } from "./reasons";

export type HoldPostOutcome =
  | { redirect: string; status: 303 }
  | { error: string; status: 409 | 422 };

interface HoldPostContext {
  member: { memberId: string } | null;
  request: Request;
  app: Pick<Env["APP"], "createHold">;
  url: URL;
}

/**
 * 處理首頁「保留」表單的 POST：未登入導向登入；成功導向會員頁；失敗回可顯示的訊息與狀態碼。
 * 表單解析失敗（例如非表單的 body）當作輸入有誤，不是 500。
 */
export async function handleHoldPost({
  member,
  request,
  app,
  url,
}: HoldPostContext): Promise<HoldPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: describeHoldFailure("invalid_input"), status: 422 };
  }

  const result = await app.createHold(member.memberId, holdFormToInput(form));
  if (result.ok) return { redirect: `/me?held=${result.data.id}`, status: 303 };

  let error = describeHoldFailure(result.reason);
  if (result.reason === "invalid_input") {
    // 欄位錯誤訊息由 App 的驗證產生，已是可顯示的文字
    const detail = Object.values(result.fields).flat()[0];
    if (detail) error = `${error}：${detail}`;
  }
  return { error, status: holdFailureStatus(result.reason) };
}
