import { and, asc, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { resources, slots } from "../catalog/schema";
import {
  MAX_ACTIVE_HOLDS_PER_MEMBER,
  memberActiveHoldCount,
  memberActiveInSlot,
} from "./member-rules";
import { activeHold, occupiedSeats } from "./occupancy";
import { CANCELLED, CONFIRMED, HELD, holds, RELEASED, type HoldStatus } from "./schema";

/** 只清理到期且仍為 held 的保留；條件更新使重送與確認後晚到的釋放皆為 no-op。 */
export async function releaseExpiredHolds(db: DrizzleD1Database, now: number): Promise<number> {
  const result = await db
    .update(holds)
    .set({ status: RELEASED })
    .where(and(eq(holds.status, HELD), lte(holds.expiresAt, now)))
    .run();
  return result.meta.changes;
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

export interface MyBooking extends BookingRecord, SlotSummary {}

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
 * 回傳 `changes`（1 = 已寫入）。
 */
export async function insertHoldIfAvailable(
  db: DrizzleD1Database,
  request: HoldRequest,
  now: number,
): Promise<number> {
  const { memberId, slotId, seats, idempotencyKey } = request;
  const result = await db.run(sql`
    INSERT INTO holds (slot_id, member_id, seats, status, expires_at, idempotency_key, created_at)
    SELECT s.id, ${memberId}, ${seats}, ${HELD}, ${now} + r.hold_ttl_seconds * 1000, ${idempotencyKey}, ${now}
    FROM slots s JOIN resources r ON r.id = s.resource_id
    WHERE s.id = ${slotId}
      AND s.starts_at > ${now}
      AND ${seats} <= r.seats_per_hold
      AND NOT ${memberActiveInSlot(memberId, sql`s.id`, now)}
      AND ${memberActiveHoldCount(memberId, now)} < ${MAX_ACTIVE_HOLDS_PER_MEMBER}
      AND ${occupiedSeats(sql`s.id`, now)} + ${seats} <= s.capacity
    ON CONFLICT (member_id, idempotency_key) DO NOTHING
  `);
  return result.meta.changes;
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
 * 成敗看 `meta.changes`；釋放有沒有跑不參與判定。回傳 `changes`（1 = 已確認）。
 */
export async function confirmHoldIfActive(
  db: DrizzleD1Database,
  memberId: string,
  holdId: number,
  now: number,
): Promise<number> {
  const result = await db.run(sql`
    UPDATE holds SET status = ${CONFIRMED}
    WHERE id = ${holdId} AND member_id = ${memberId} AND ${activeHold(now)}
      AND ${memberExists(memberId)}
  `);
  return result.meta.changes;
}

/** 會員帳號（Better Auth 的 user）仍存在；確認與其診斷共用，兩處對「會員存在」有同一個定義。 */
const memberExists = (memberId: string): SQL => sql`EXISTS (SELECT 1 FROM "user" WHERE id = ${memberId})`;

export interface OwnHold {
  id: number;
  slotId: number;
  seats: number;
  status: HoldStatus;
}

/** 確認失敗後的唯讀診斷：只讀該會員自己的保留（別人的、帳號已刪除的一律當作不存在）。 */
export async function selectOwnHold(
  db: DrizzleD1Database,
  memberId: string,
  holdId: number,
): Promise<OwnHold | undefined> {
  const rows = await db
    .select({ id: holds.id, slotId: holds.slotId, seats: holds.seats, status: holds.status })
    .from(holds)
    .where(and(eq(holds.id, holdId), eq(holds.memberId, memberId), memberExists(memberId)))
    .limit(1);
  return rows[0];
}

/** 會員自己的訂位，依時段開始時間、id 排序。 */
export async function selectBookings(db: DrizzleD1Database, memberId: string): Promise<MyBooking[]> {
  return db
    .select({
      id: holds.id,
      slotId: holds.slotId,
      seats: holds.seats,
      resourceName: resources.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
    })
    .from(holds)
    .innerJoin(slots, eq(slots.id, holds.slotId))
    .innerJoin(resources, eq(resources.id, slots.resourceId))
    .where(and(eq(holds.memberId, memberId), eq(holds.status, CONFIRMED)))
    .orderBy(asc(slots.startsAt), asc(holds.id));
}

/** 帳號刪除用：會員未來時段（`starts_at > now`）的訂位改為已取消；已開始時段的是歷史紀錄，不動。回傳 batch 用的語句。 */
export function cancelFutureBookings(db: DrizzleD1Database, memberId: string, now: number) {
  const futureSlots = db.select({ id: slots.id }).from(slots).where(gt(slots.startsAt, now));
  return db
    .update(holds)
    .set({ status: CANCELLED })
    .where(and(eq(holds.memberId, memberId), eq(holds.status, CONFIRMED), inArray(holds.slotId, futureSlots)));
}

/** 帳號刪除用：會員所有保留中的保留改為已釋放（含已過期尚未清理的）。回傳 batch 用的語句。 */
export function releaseMemberHolds(db: DrizzleD1Database, memberId: string) {
  return db
    .update(holds)
    .set({ status: RELEASED })
    .where(and(eq(holds.memberId, memberId), eq(holds.status, HELD)));
}
