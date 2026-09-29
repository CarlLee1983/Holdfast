import type { Auth } from "./auth";

/** Web Worker 需要知道的會員資訊；不含 session token。時間用 epoch ms（RPC 最保險）。 */
export interface MemberSession {
  memberId: string;
  name: string;
  expiresAt: number;
}

export async function readMemberSession(auth: Auth, cookie: string): Promise<MemberSession | null> {
  if (!cookie) return null;
  const found = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!found) return null;
  return {
    memberId: found.user.id,
    name: found.user.name,
    expiresAt: found.session.expiresAt.getTime(),
  };
}
