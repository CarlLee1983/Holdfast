import type { Auth } from "./auth";

/** Web Worker 需要知道的會員資訊；不含 session token。時間用 epoch ms（RPC 最保險）。 */
export interface MemberSession {
  memberId: string;
  name: string;
  expiresAt: number;
}

export interface MemberSessionLookup {
  member: MemberSession | null;
  /**
   * Better Auth 在 session 逾 updateAge 而延長時產生的 Set-Cookie。RPC 沒有 Response 可以帶它，
   * 所以隨結果一起回傳，由 Web Worker 附加到回給瀏覽器的回應，cookie 的壽命才會跟 D1 裡的 session 一致。
   */
  setCookies: string[];
}

export async function readMemberSession(auth: Auth, cookie: string): Promise<MemberSessionLookup> {
  if (!cookie) return { member: null, setCookies: [] };
  const { headers, response } = await auth.api.getSession({
    headers: new Headers({ cookie }),
    returnHeaders: true,
  });
  const setCookies = headers.getSetCookie();
  if (!response) return { member: null, setCookies };
  return {
    member: {
      memberId: response.user.id,
      name: response.user.name,
      expiresAt: response.session.expiresAt.getTime(),
    },
    setCookies,
  };
}
