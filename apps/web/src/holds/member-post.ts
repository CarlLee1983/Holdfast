import { loginUrl } from "../auth/member";
import { withFirstFieldDetail } from "../shared/reasons";
import { holdFailureStatus } from "./reasons";

export type MemberPostOutcome =
  | { redirect: string; status: 303 }
  | { error: string; status: 409 | 422 };

/** App 回傳中這裡會用到的部分：成功要有編號，失敗要有 reason（invalid_input 另有欄位錯誤）。 */
type RpcResult =
  | { ok: true; data: { id: number } }
  | { ok: false; reason: string; fields?: Record<string, string[]> };

interface MemberPostSpec {
  member: { memberId: string } | null;
  /** 要操作的編號（可能是 NaN：合法性交給 App 驗證並回 invalid_input）。 */
  id: number;
  url: URL;
  /** 送給 App 的輸入欄位名稱。 */
  field: string;
  /** 成功後導向的網址，由成功操作回傳的編號組成。 */
  successUrl: (id: number) => string;
  call: (memberId: string, input: Record<string, number>) => Promise<RpcResult>;
  describe: (reason: string) => string;
}

/** 會員頁與確認頁 POST 的共同流程：未登入導向登入；成功導向 successUrl；失敗回可顯示的訊息與狀態碼。 */
export async function handleMemberFormPost({
  member,
  id,
  url,
  field,
  successUrl,
  call,
  describe,
}: MemberPostSpec): Promise<MemberPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };

  const result = await call(member.memberId, { [field]: id });
  if (result.ok) return { redirect: successUrl(result.data.id), status: 303 };

  const message = describe(result.reason);
  const error = result.reason === "invalid_input" && result.fields ? withFirstFieldDetail(message, result.fields) : message;
  return { error, status: holdFailureStatus(result.reason) };
}
