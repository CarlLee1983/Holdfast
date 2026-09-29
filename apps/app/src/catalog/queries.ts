import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { resources, slots } from "./schema";

export interface ResourceSummary {
  id: number;
  name: string;
  holdTtlSeconds: number;
  seatsPerHold: number;
  cancellationCutoffSeconds: number;
}

export interface SlotAvailability {
  id: number;
  startsAt: number;
  endsAt: number;
  capacity: number;
  remainingSeats: number;
}

export async function selectResources(
  db: DrizzleD1Database,
): Promise<ResourceSummary[]> {
  return db
    .select({
      id: resources.id,
      name: resources.name,
      holdTtlSeconds: resources.holdTtlSeconds,
      seatsPerHold: resources.seatsPerHold,
      cancellationCutoffSeconds: resources.cancellationCutoffSeconds,
    })
    .from(resources)
    .orderBy(asc(resources.id));
}

export async function resourceExists(
  db: DrizzleD1Database,
  resourceId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  return rows.length > 0;
}

/**
 * 剩餘名額（Seat）唯一的計算處。ADR 0004：不存已占用計數欄位，
 * 之後保留與訂位進來時，在這裡以「容量 - 未過期保留與訂位的名額總和」的子查詢擴充。
 * 目前還沒有保留，剩餘名額等於容量（Capacity）。
 */
const remainingSeats = () => sql<number>`${slots.capacity}`;

/** 列出尚未結束（`ends_at > now`）的時段與剩餘名額，依開始時間排序。 */
export async function selectSlotAvailability(
  db: DrizzleD1Database,
  resourceId: number,
  now: number,
): Promise<SlotAvailability[]> {
  return db
    .select({
      id: slots.id,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      capacity: slots.capacity,
      remainingSeats: remainingSeats().as("remaining_seats"),
    })
    .from(slots)
    .where(and(eq(slots.resourceId, resourceId), gt(slots.endsAt, now)))
    .orderBy(asc(slots.startsAt), asc(slots.id));
}
