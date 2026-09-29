import { loginUrl } from "../auth/member";
import { toNumber } from "../shared/form-values";
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
  form: FormData;
  url: URL;
  /** 表單裡放編號的欄位名稱，同時是送給 App 的輸入欄位名稱。 */
  field: string;
  /** 成功後導回 `/me?<successParam>=<id>`。 */
  successParam: string;
  call: (memberId: string, input: Record<string, number>) => Promise<RpcResult>;
  describe: (reason: string) => string;
}

/** 會員頁表單 POST 的共同流程：未登入導向登入；成功導向會員頁；失敗回可顯示的訊息與狀態碼。 */
export async function handleMemberFormPost({
  member,
  form,
  url,
  field,
  successParam,
  call,
  describe,
}: MemberPostSpec): Promise<MemberPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303 };

  const result = await call(member.memberId, { [field]: toNumber(form.get(field)) });
  if (result.ok) return { redirect: `/me?${successParam}=${result.data.id}`, status: 303 };

  const message = describe(result.reason);
  const error = result.reason === "invalid_input" && result.fields ? withFirstFieldDetail(message, result.fields) : message;
  return { error, status: holdFailureStatus(result.reason) };
}
