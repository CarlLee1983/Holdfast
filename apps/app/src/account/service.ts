import { and, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { account, session, user } from "../auth/schema";
import { slots } from "../catalog/schema";
import { memberIdInput } from "../holds/input";
import { CANCELLED, CONFIRMED, HELD, holds, RELEASED } from "../holds/schema";
import type { Clock } from "../shared/clock";
import { parseInput } from "../shared/input";
import { ok, type InvalidInput, type Result } from "../shared/result";

export interface DeleteAccountSummary {
  cancelledBookings: number;
  releasedHolds: number;
}

export type DeleteAccountResult = Result<DeleteAccountSummary, never> | InvalidInput;

export function createAccountService(d1: D1Database, clock: Clock) {
  const db = drizzle(d1);

  return {
    /**
     * 刪除會員帳號：未來的訂位改為已取消、保留中的保留改為已釋放，並移除 Better Auth 的 user / session / account。
     * 全部放進同一個 D1 batch（一起成功或一起回滾），中途失敗不會留下「名額已還但帳號還在」的半套狀態。
     * 已開始時段的訂位是歷史紀錄，不動。對已刪除（或不存在）的會員再呼叫是成功的 no-op，所以重送安全。
     */
    async deleteAccount(memberId: unknown): Promise<DeleteAccountResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      const id = member.data;
      const now = clock.now();
      const futureSlots = db.select({ id: slots.id }).from(slots).where(gt(slots.startsAt, now));

      const [cancelled, released] = await db.batch([
        db
          .update(holds)
          .set({ status: CANCELLED })
          .where(and(eq(holds.memberId, id), eq(holds.status, CONFIRMED), inArray(holds.slotId, futureSlots))),
        // 保留中的一律釋放（含已過期但尚未被清理的），會員不在了，留著沒有意義
        db
          .update(holds)
          .set({ status: RELEASED })
          .where(and(eq(holds.memberId, id), eq(holds.status, HELD))),
        db.delete(session).where(eq(session.userId, id)),
        db.delete(account).where(eq(account.userId, id)),
        db.delete(user).where(eq(user.id, id)),
      ]);

      const summary = {
        cancelledBookings: cancelled.meta.changes,
        releasedHolds: released.meta.changes,
      };
      console.log(JSON.stringify({ event: "account_deleted", ...summary }));
      return ok(summary);
    },
  };
}
