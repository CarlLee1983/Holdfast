import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { account, session, user } from "../auth/schema";

/** 移除會員的 Better Auth 資料（session、account、user）。回傳 batch 用的語句，順序即外鍵安全的刪除順序。 */
export function deleteAuthData(db: DrizzleD1Database, memberId: string) {
  return [
    db.delete(session).where(eq(session.userId, memberId)),
    db.delete(account).where(eq(account.userId, memberId)),
    db.delete(user).where(eq(user.id, memberId)),
  ] as const;
}
