import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { occupiedSeats } from "../holds/occupancy";
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
 * 剩餘名額（Seat）= 容量 - 已占用名額，占用的定義只在 `occupiedSeats`（ADR 0004）。
 * 已過期但尚未釋放的保留不算占用（ADR 0003）；超占（占用 > 容量）時以 0 顯示。
 */
const remainingSeats = (now: number) =>
  sql<number>`MAX(${slots.capacity} - ${occupiedSeats(sql`${slots.id}`, now)}, 0)`;

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
      remainingSeats: remainingSeats(now).as("remaining_seats"),
    })
    .from(slots)
    .where(and(eq(slots.resourceId, resourceId), gt(slots.endsAt, now)))
    .orderBy(asc(slots.startsAt), asc(slots.id));
}
