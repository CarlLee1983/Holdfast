import { drizzle } from "drizzle-orm/d1";
import type { Clock } from "../shared/clock";
import { fail, ok, type InvalidInput, type Result } from "../shared/result";
import { parseInput } from "../shared/input";
import { MAX_ACTIVE_HOLDS_PER_MEMBER } from "./member-rules";
import { confirmHoldInput, createHoldInput, memberIdInput } from "./input";
import {
  confirmHoldIfActive,
  insertHoldIfAvailable,
  releaseExpiredHolds,
  selectActiveHolds,
  selectBookings,
  selectHoldByKey,
  selectHoldDiagnosis,
  selectOwnHold,
  type BookingRecord,
  type HoldRecord,
  type HoldRequest,
  type MyBooking,
  type MyHold,
} from "./queries";
import { CANCELLED, CONFIRMED, HELD, RELEASED } from "./schema";

export type CreateHoldResult =
  | Result<
      HoldRecord,
      | "idempotency_key_conflict"
      | "slot_not_found"
      | "slot_started"
      | "already_in_slot"
      | "active_hold_limit_reached"
      | "seats_per_hold_exceeded"
      | "slot_overcommitted"
      | "insufficient_seats"
    >
  | InvalidInput;

export type ConfirmHoldResult = Result<BookingRecord, "hold_not_found" | "hold_expired"> | InvalidInput;

export type ListMyBookingsResult = Result<MyBooking[], never> | InvalidInput;

export type ListMyHoldsResult = Result<MyHold[], never> | InvalidInput;

export function createHoldService(d1: D1Database, clock: Clock) {
  const db = drizzle(d1);

  /** 條件寫入沒寫進去（changes = 0）之後，讀取現況決定回哪個 reason；只影響訊息，不影響正確性。 */
  async function diagnose(request: HoldRequest, now: number): Promise<CreateHoldResult> {
    const existing = await selectHoldByKey(db, request.memberId, request.idempotencyKey);
    if (existing) {
      // 冪等重送：內容相同就回原本那一筆（即使已過期），內容不同是鍵被誤用
      return existing.slotId === request.slotId && existing.seats === request.seats
        ? ok(existing)
        : fail("idempotency_key_conflict");
    }
    const slot = await selectHoldDiagnosis(db, request.memberId, request.slotId, now);
    if (!slot) return fail("slot_not_found");
    if (slot.startsAt <= now) return fail("slot_started");
    if (slot.memberInSlot) return fail("already_in_slot");
    if (slot.memberActiveHolds >= MAX_ACTIVE_HOLDS_PER_MEMBER) return fail("active_hold_limit_reached");
    if (request.seats > slot.seatsPerHold) return fail("seats_per_hold_exceeded");
    if (slot.occupied > slot.capacity) return fail("slot_overcommitted");
    return fail("insufficient_seats");
  }

  return {
    async releaseExpiredHolds() {
      return ok({ releasedCount: await releaseExpiredHolds(db, clock.now()) });
    },

    async createHold(memberId: unknown, input: unknown): Promise<CreateHoldResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      const parsed = parseInput(createHoldInput, input);
      if (!parsed.ok) return parsed;

      const request: HoldRequest = { memberId: member.data, ...parsed.data };
      const now = clock.now();
      const changes = await insertHoldIfAvailable(db, request, now);
      if (changes === 0) return diagnose(request, now);

      // 剛寫入的那一筆以（會員, 冪等鍵）取回；這組鍵有唯一約束，一定是它
      const created = await selectHoldByKey(db, request.memberId, request.idempotencyKey);
      if (!created) throw new Error("保留已寫入但讀不回來");
      console.log(
        JSON.stringify({
          event: "hold_created",
          holdId: created.id,
          slotId: created.slotId,
          seats: created.seats,
        }),
      );
      return ok(created);
    },

    async listMyHolds(memberId: unknown): Promise<ListMyHoldsResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      return ok(await selectActiveHolds(db, member.data, clock.now()));
    },

    async confirmHold(memberId: unknown, input: unknown): Promise<ConfirmHoldResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      const parsed = parseInput(confirmHoldInput, input);
      if (!parsed.ok) return parsed;

      const { holdId } = parsed.data;
      const changes = await confirmHoldIfActive(db, member.data, holdId, clock.now());
      // 寫入之後再讀：成功時就是剛確認的那筆；changes = 0 時診斷原因，只影響回應，不影響正確性
      const own = await selectOwnHold(db, member.data, holdId);
      if (!own) return fail("hold_not_found");
      if (changes === 1) {
        console.log(JSON.stringify({ event: "hold_confirmed", holdId, slotId: own.slotId, seats: own.seats }));
      }
      // 新增狀態時這裡會編譯失敗，必須決定該回哪個 reason
      switch (own.status) {
        case CONFIRMED:
          // 重複確認回同一筆訂位（冪等）
          return ok({ id: own.id, slotId: own.slotId, seats: own.seats });
        case HELD:
          // 保留中卻沒寫進去，就是已到期
          return fail("hold_expired");
        case RELEASED:
          // 釋放只會發生在到期之後（#9），對會員而言同樣是已到期
          return fail("hold_expired");
        case CANCELLED:
          return fail("hold_expired");
        default: {
          const unhandled: never = own.status;
          throw new Error(`未處理的保留狀態：${String(unhandled)}`);
        }
      }
    },

    async listMyBookings(memberId: unknown): Promise<ListMyBookingsResult> {
      const member = parseInput(memberIdInput, memberId);
      if (!member.ok) return member;
      return ok(await selectBookings(db, member.data));
    },
  };
}
