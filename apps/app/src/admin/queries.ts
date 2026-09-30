import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { slots } from "../catalog/schema";
import { occupiedSeats } from "../holds/occupancy";

export interface AdminAuditRecord {
  id: number;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: number;
  at: number;
  detail: string;
}

/** 額外讀一筆，只用來判斷是否還有下一頁。 */
export async function selectAdminAudit(d1: D1Database, cursor?: number): Promise<{ rows: AdminAuditRecord[]; nextCursor: number | null }> {
  const statement = d1.prepare(
    `SELECT id, actor_email AS actorEmail, action, target_type AS targetType,
            target_id AS targetId, at, detail FROM admin_audit
     ${cursor === undefined ? "" : "WHERE id < ?"}
     ORDER BY id DESC LIMIT 51`,
  );
  const { results } = await (cursor === undefined ? statement : statement.bind(cursor)).all<AdminAuditRecord>();
  const rows = results.slice(0, 50);
  return { rows, nextCursor: results.length > 50 ? rows[49]!.id : null };
}

export interface AdminSlot {
  id: number;
  startsAt: number;
  endsAt: number;
  capacity: number;
  occupied: number;
  remainingSeats: number;
  /** 已占用 > 容量；每次由占用即時算出，不存旗標（CONTEXT.md「超占」）。 */
  overcommitted: boolean;
}

/**
 * 管理者看的時段列表：含已結束的時段（沒有訂位的可以刪除清理），並帶出占用與超占狀態。
 * 占用的定義只在 `occupiedSeats`（ADR 0004），這裡不重新定義。
 */
export async function selectAdminSlots(
  db: DrizzleD1Database,
  resourceId: number,
  now: number,
): Promise<AdminSlot[]> {
  const rows = await db
    .select({
      id: slots.id,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      capacity: slots.capacity,
      occupied: occupiedSeats(sql`${slots.id}`, now).as("occupied"),
    })
    .from(slots)
    .where(eq(slots.resourceId, resourceId))
    .orderBy(asc(slots.startsAt), asc(slots.id));
  return rows.map((row) => ({
    ...row,
    remainingSeats: Math.max(row.capacity - row.occupied, 0),
    overcommitted: row.occupied > row.capacity,
  }));
}

/** 刪除失敗後的唯讀診斷：只用來決定回哪個 reason。 */
export async function slotExists(db: DrizzleD1Database, slotId: number): Promise<boolean> {
  const rows = await db.select({ id: slots.id }).from(slots).where(eq(slots.id, slotId)).limit(1);
  return rows.length > 0;
}
