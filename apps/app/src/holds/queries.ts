import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { resources, slots } from "../catalog/schema";
import {
  MAX_ACTIVE_HOLDS_PER_MEMBER,
  memberActiveHoldCount,
  memberActiveInSlot,
} from "./member-rules";
import { activeHold, HELD, occupiedSeats } from "./occupancy";
import { holds, RELEASED } from "./schema";

/** 只清理到期且仍為 held 的保留；條件更新使重送與確認後晚到的釋放皆為 no-op。 */
export async function releaseExpiredHolds(db: DrizzleD1Database, now: number): Promise<number> {
  const result = await db
    .update(holds)
    .set({ status: RELEASED })
    .where(and(eq(holds.status, HELD), lte(holds.expiresAt, now)))
    .run();
  return result.meta.changes;
}

export interface HoldRecord {
  id: number;
  slotId: number;
  seats: number;
  expiresAt: number;
}

export interface MyHold extends HoldRecord {
  resourceName: string;
  startsAt: number;
  endsAt: number;
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
