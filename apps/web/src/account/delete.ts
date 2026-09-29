import { AUTH_COOKIE_PREFIX } from "@holdfast/app/auth-paths";
import { loginUrl } from "../auth/member";

export type DeleteAccountPostOutcome =
  | { redirect: string; status: 303; setCookies: string[] }
  | { error: string; status: 422 };

interface DeleteAccountPostContext {
  member: { memberId: string } | null;
  app: Pick<Env["APP"], "deleteAccount">;
  url: URL;
}

/**
 * 讓瀏覽器丟掉 Better Auth 的 session cookie。App 已刪掉 D1 裡的 session，cookie 留著也只會被當成未登入，
 * 但不該把已失效的 token 留在瀏覽器。名稱與屬性要和 Better Auth 設的一致：https 下有 `__Secure-` 前綴與 Secure。
 */
function clearedSessionCookie(url: URL): string {
  const secure = url.protocol === "https:";
  const name = `${secure ? "__Secure-" : ""}${AUTH_COOKIE_PREFIX}.session_token`;
  return `${name}=; Path=/; Max-Age=0; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

/** 處理「刪除帳號」表單的 POST：未登入導向登入；成功後清 session cookie 並回首頁。 */
export async function handleDeleteAccountPost({
  member,
  app,
  url,
}: DeleteAccountPostContext): Promise<DeleteAccountPostOutcome> {
  if (!member) return { redirect: loginUrl(url), status: 303, setCookies: [] };

  const result = await app.deleteAccount(member.memberId);
  if (!result.ok) return { error: "輸入有誤", status: 422 };
  return { redirect: "/", status: 303, setCookies: [clearedSessionCookie(url)] };
}
