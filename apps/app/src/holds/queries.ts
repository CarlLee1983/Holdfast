import { and, asc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { resources, slots } from "../catalog/schema";
import {
  MAX_ACTIVE_HOLDS_PER_MEMBER,
  memberActiveHoldCount,
  memberActiveInSlot,
} from "./member-rules";
import { cancellableUntil, withinCancellationCutoff } from "./cancellation";
import { activeHold, expiredHold, occupiedSeats } from "./occupancy";
import { effectiveNow, writeAtEffectiveNow, type BumpedWriteResult } from "../shared/high-water-mark";
import { CANCELLED, CONFIRMED, HELD, holds, RELEASED, type HoldStatus } from "./schema";

/**
 * 只清理到期且仍為 held 的保留；條件更新使重送與確認後晚到的釋放皆為 no-op。
 * 到期以高水位的有效時間判定（ADR 0011），`now` 只用來推進高水位。
 */
export async function releaseExpiredHolds(d1: D1Database, now: number): Promise<number> {
  const { changes } = await writeAtEffectiveNow(
    d1,
    now,
    sql`UPDATE holds SET status = ${RELEASED} WHERE ${expiredHold(effectiveNow)}`,
  );
  return changes;
}

/** 保留與訂位共有的欄位；訂位就是已確認的保留，沿用保留的 id。 */
export interface BookingRecord {
  id: number;
  slotId: number;
  seats: number;
}

export interface HoldRecord extends BookingRecord {
  expiresAt: number;
}

/** 列表用：資源名稱與時段時間。 */
export interface SlotSummary {
  resourceName: string;
  startsAt: number;
  endsAt: number;
}

export interface MyHold extends HoldRecord, SlotSummary {}

export interface MyBooking extends BookingRecord, SlotSummary {
  status: typeof CONFIRMED | typeof CANCELLED;
  cancelledAt: number | null;
  cancelledBy: "admin" | "member" | null;
  /** 取消截止時刻（UTC epoch 毫秒）：`now <= cancellableUntil` 才能取消。 */
  cancellableUntil: number;
}

export interface HoldRequest {
  memberId: string;
  slotId: number;
  seats: number;
  idempotencyKey: string;
}

/**
 * 建立保留的單一條件寫入（ADR 0004）：檢查與寫入在同一句，成敗看 `meta.changes`。
 * 保留期限在語句內從資源讀出，所以修改期限只影響之後的保留。
 * 會員層級的兩條規則（同時段不重複、有效保留不超過上限）也在這句裡，不另設檢查步驟。
 * 冪等鍵重複（同會員同鍵）時 `ON CONFLICT DO NOTHING`，changes 為 0，由呼叫端診斷。
 * 語句裡的時間一律是高水位的有效時間（ADR 0011），`now` 只用來推進高水位。
 * 回傳 `changes`（1 = 已寫入）與寫入採用的有效時間（失敗後診斷用）。
 */
export async function insertHoldIfAvailable(
  d1: D1Database,
  request: HoldRequest,
  now: number,
): Promise<BumpedWriteResult> {
  const { memberId, slotId, seats, idempotencyKey } = request;
  return writeAtEffectiveNow(
    d1,
    now,
    sql`
    INSERT INTO holds (slot_id, member_id, seats, status, expires_at, idempotency_key, created_at)
    SELECT s.id, ${memberId}, ${seats}, ${HELD}, ${effectiveNow} + r.hold_ttl_seconds * 1000, ${idempotencyKey}, ${effectiveNow}
    FROM slots s JOIN resources r ON r.id = s.resource_id
    WHERE s.id = ${slotId}
      AND s.starts_at > ${effectiveNow}
      AND ${seats} <= r.seats_per_hold
      AND NOT ${memberActiveInSlot(memberId, sql`s.id`, effectiveNow)}
      AND ${memberActiveHoldCount(memberId, effectiveNow)} < ${MAX_ACTIVE_HOLDS_PER_MEMBER}
      AND ${occupiedSeats(sql`s.id`, effectiveNow)} + ${seats} <= s.capacity
    ON CONFLICT (member_id, idempotency_key) DO NOTHING
  `,
  );
}

const holdColumns = {
  id: holds.id,
  slotId: holds.slotId,
  seats: holds.seats,
  expiresAt: holds.expiresAt,
};

export async function selectHoldByKey(
  db: DrizzleD1Database,
  memberId: string,
  idempotencyKey: string,
): Promise<HoldRecord | undefined> {
  const rows = await db
    .select(holdColumns)
    .from(holds)
    .where(and(eq(holds.memberId, memberId), eq(holds.idempotencyKey, idempotencyKey)))
    .limit(1);
  return rows[0];
}

export interface HoldDiagnosis {
  startsAt: number;
  capacity: number;
  seatsPerHold: number;
  occupied: number;
  memberInSlot: boolean;
  memberActiveHolds: number;
}

/** 條件寫入失敗後的唯讀診斷（時段與會員兩面，一次查詢）：只用來決定回哪個 reason，不影響正確性。時段不存在回 undefined。 */
export async function selectHoldDiagnosis(
  db: DrizzleD1Database,
  memberId: string,
  slotId: number,
  now: number,
): Promise<HoldDiagnosis | undefined> {
  const rows = await db
    .select({
      startsAt: slots.startsAt,
      capacity: slots.capacity,
      seatsPerHold: resources.seatsPerHold,
      occupied: occupiedSeats(sql`${slots.id}`, now).as("occupied"),
      memberInSlot: memberActiveInSlot(memberId, sql`${slots.id}`, now).mapWith(Boolean).as("member_in_slot"),
      memberActiveHolds: memberActiveHoldCount(memberId, now).as("member_active_holds"),
    })
    .from(slots)
    .innerJoin(resources, eq(resources.id, slots.resourceId))
    .where(eq(slots.id, slotId))
    .limit(1);
  return rows[0];
}

/** 會員自己仍有效（未過期）的保留，依到期時間、id 排序。 */
export async function selectActiveHolds(
  db: DrizzleD1Database,
  memberId: string,
  now: number,
): Promise<MyHold[]> {
  return db
    .select({
      ...holdColumns,
      resourceName: resources.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
    })
    .from(holds)
    .innerJoin(slots, eq(slots.id, holds.slotId))
    .innerJoin(resources, eq(resources.id, slots.resourceId))
    .where(and(eq(holds.memberId, memberId), activeHold(now)))
    .orderBy(asc(holds.expiresAt), asc(holds.id));
}

/**
 * 確認的單一條件寫入（ADR 0003、0004）：保留屬於該會員、狀態為保留中、且 `now < expires_at`。
 * 會員帳號必須仍存在，避免與帳號刪除交錯後留下屬於已刪除會員、永久占名額的訂位。
 * 語句裡的時間是高水位的有效時間（ADR 0011），`now` 只用來推進高水位。
 * 成敗看 `meta.changes`；釋放有沒有跑不參與判定。回傳 `changes`（1 = 已確認）。
 */
export async function confirmHoldIfActive(
  d1: D1Database,
  memberId: string,
  holdId: number,
  now: number,
): Promise<number> {
  const { changes } = await writeAtEffectiveNow(
    d1,
    now,
    sql`
    UPDATE holds SET status = ${CONFIRMED}
    WHERE id = ${holdId} AND member_id = ${memberId} AND ${activeHold(effectiveNow)}
      AND ${memberExists(memberId)}
  `,
  );
  return changes;
}

/**
 * 取消的單一條件寫入（ADR 0004）：訂位屬於該會員、狀態為 confirmed、且仍在取消截止時刻內
 * （定義見 `withinCancellationCutoff`，用資源目前的設定，不做快照）。
 * 語句裡的時間（截止判定與寫下的 `cancelled_at`）是高水位的有效時間（ADR 0011），`now` 只用來推進高水位。
 * 成敗看 `meta.changes`；已取消的重送 changes 為 0，由呼叫端診斷。回傳 `changes`（1 = 已取消）。
 */
export async function cancelBookingIfBeforeCutoff(
  d1: D1Database,
  memberId: string,
  bookingId: number,
  now: number,
): Promise<number> {
  const { changes } = await writeAtEffectiveNow(
    d1,
    now,
    sql`
    UPDATE holds SET status = ${CANCELLED}, cancelled_at = ${effectiveNow}, cancelled_by = 'member'
    WHERE id = ${bookingId} AND member_id = ${memberId} AND status = ${CONFIRMED}
      AND EXISTS (
        SELECT 1 FROM ${slots} JOIN ${resources} ON ${resources.id} = ${slots.resourceId}
        WHERE ${slots.id} = ${holds.slotId} AND ${withinCancellationCutoff(effectiveNow)}
      )
  `,
  );
  return changes;
}

/** 會員帳號（Better Auth 的 user）仍存在；確認與其診斷共用，兩處對「會員存在」有同一個定義。 */
const memberExists = (memberId: string): SQL => sql`EXISTS (SELECT 1 FROM "user" WHERE id = ${memberId})`;

export interface OwnHold {
  id: number;
  slotId: number;
  seats: number;
  status: HoldStatus;
  /** 只有已取消的訂位有值。 */
  cancelledAt: number | null;
}

/** 確認、取消失敗後的唯讀診斷：只讀該會員自己的保留（別人的、帳號已刪除的一律當作不存在）。 */
export async function selectOwnHold(
  db: DrizzleD1Database,
  memberId: string,
  holdId: number,
): Promise<OwnHold | undefined> {
  const rows = await db
    .select({ id: holds.id, slotId: holds.slotId, seats: holds.seats, status: holds.status, cancelledAt: holds.cancelledAt })
    .from(holds)
    .where(and(eq(holds.id, holdId), eq(holds.memberId, memberId), memberExists(memberId)))
    .limit(1);
  return rows[0];
}

/** 會員自己的訂位，依時段開始時間、id 排序。 */
export async function selectBookings(db: DrizzleD1Database, memberId: string): Promise<MyBooking[]> {
  const rows = await db
    .select({
      id: holds.id,
      slotId: holds.slotId,
      seats: holds.seats,
      status: holds.status,
      cancelledAt: holds.cancelledAt,
      cancelledBy: holds.cancelledBy,
      resourceName: resources.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      cancellableUntil,
    })
    .from(holds)
    .innerJoin(slots, eq(slots.id, holds.slotId))
    .innerJoin(resources, eq(resources.id, slots.resourceId))
    .where(
      and(
        eq(holds.memberId, memberId),
        // 會員自己取消的訂位離開列表（#10）；被管理者取消的要讓會員看得到（#12）
        or(eq(holds.status, CONFIRMED), and(eq(holds.status, CANCELLED), eq(holds.cancelledBy, "admin"))),
      ),
    )
    .orderBy(asc(slots.startsAt), asc(holds.id));
  return rows.map((row) => ({ ...row, status: row.status as MyBooking["status"] }));
}

/**
 * 帳號刪除用：會員未來時段（`starts_at > 有效時間`）的訂位改為已取消；已開始時段的是歷史紀錄，不動。回傳 batch 用的語句。
 * 取消者記為會員（刪帳號是會員自己的操作），取消時間是與判定同一個有效時間（#32）。
 * 時間是高水位的有效時間，必須放進 `batchAtEffectiveNow` 執行（ADR 0011）。
 */
export function cancelFutureBookings(db: DrizzleD1Database, memberId: string) {
  const futureSlots = db.select({ id: slots.id }).from(slots).where(gt(slots.startsAt, effectiveNow));
  return db
    .update(holds)
    .set({ status: CANCELLED, cancelledAt: effectiveNow, cancelledBy: "member" })
    .where(and(eq(holds.memberId, memberId), eq(holds.status, CONFIRMED), inArray(holds.slotId, futureSlots)));
}

/** 帳號刪除用：會員所有保留中的保留改為已釋放（含已過期尚未清理的）。回傳 batch 用的語句。 */
export function releaseMemberHolds(db: DrizzleD1Database, memberId: string) {
  return db
    .update(holds)
    .set({ status: RELEASED })
    .where(and(eq(holds.memberId, memberId), eq(holds.status, HELD)));
}
