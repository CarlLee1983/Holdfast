import { drizzle } from "drizzle-orm/d1";
import { memberIdInput } from "../holds/input";
import { cancelFutureBookings, releaseMemberHolds } from "../holds/queries";
import type { Clock } from "../shared/clock";
import { batchAtEffectiveNow } from "../shared/high-water-mark";
import { parseInput } from "../shared/input";
import { ok, type InvalidInput, type Result } from "../shared/result";
import { deleteAuthData } from "./queries";

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
     * 全部放進同一個 D1 batch（一起成功或一起回滾；未來時段以高水位的有效時間判定），中途失敗不會留下「名額已還但帳號還在」的半套狀態。
     * 已開始時段的訂位是歷史紀錄，不動。對已刪除（或不存在）的會員再呼叫是成功的 no-op，所以重送安全。
     */
    async deleteAccount(memberId: unknown): Promise<DeleteAccountResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      const id = member.data;
      const now = clock.now();
      // 有效時間的推進由 batchAtEffectiveNow 放在第一句（ADR 0011）；計數只看各自語句的 changes
      const [cancelled, released] = await batchAtEffectiveNow(d1, now, [
        cancelFutureBookings(db, id),
        releaseMemberHolds(db, id),
        ...deleteAuthData(db, id),
      ]);

      const summary = {
        cancelledBookings: cancelled!.meta.changes,
        releasedHolds: released!.meta.changes,
      };
      console.log(JSON.stringify({ event: "account_deleted", ...summary }));
      return ok(summary);
    },
  };
}
