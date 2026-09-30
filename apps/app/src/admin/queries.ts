import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { user } from "../auth/schema";
import { resources, slots } from "../catalog/schema";
import { activeHold, occupiedSeats } from "../holds/occupancy";
import { CANCELLED, CONFIRMED, HELD, holds } from "../holds/schema";

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
  return rows.map(withSeatSummary);
}

/** 剩餘與超占都由容量與占用即時算出（不存旗標）；時段列表與日程表共用。 */
function withSeatSummary<T extends { capacity: number; occupied: number }>(row: T) {
  return {
    ...row,
    remainingSeats: Math.max(row.capacity - row.occupied, 0),
    overcommitted: row.occupied > row.capacity,
  };
}

export interface AgendaBooking {
  id: number;
  memberName: string | null;
  seats: number;
}

export interface AgendaHold extends AgendaBooking {
  expiresAt: number;
}

export interface AgendaCancelledBooking extends AgendaBooking {
  /** 早於這兩個欄位（migration 0005、0006）的已取消訂位沒有這兩個值，沒有回填。 */
  cancelledBy: "admin" | "member" | null;
  cancelledAt: number | null;
}

export interface AgendaSlot extends AdminSlot {
  resourceId: number;
  resourceName: string;
  bookings: AgendaBooking[];
  holds: AgendaHold[];
  cancelledBookings: AgendaCancelledBooking[];
}

/**
 * 日程表：開始時間落在 [from, to) 的時段（跨資源，可只看一個資源），連同三類名單。
 * 兩個查詢（時段、這些時段的名單）再在 TS 依時段分組，不是一個時段一個查詢。
 * 名單只收訂位、有效保留（`activeHold`，到期未釋放的不算）與已取消的訂位。
 */
export async function selectAgenda(
  db: DrizzleD1Database,
  range: { from: number; to: number; resourceId?: number },
  now: number,
): Promise<AgendaSlot[]> {
  const inAgenda = and(
    gte(slots.startsAt, range.from),
    lt(slots.startsAt, range.to),
    range.resourceId === undefined ? undefined : eq(slots.resourceId, range.resourceId),
  );
  const rows = await db
    .select({
      id: slots.id,
      resourceId: slots.resourceId,
      resourceName: resources.name,
      startsAt: slots.startsAt,
      endsAt: slots.endsAt,
      capacity: slots.capacity,
      occupied: occupiedSeats(sql`${slots.id}`, now).as("occupied"),
    })
    .from(slots)
    .innerJoin(resources, eq(resources.id, slots.resourceId))
    .where(inAgenda)
    .orderBy(asc(slots.startsAt), asc(slots.id));
  if (rows.length === 0) return [];

  // 以子查詢帶入同一個區間條件，綁定參數個數與時段數無關（逐一列出 id 會撞上 D1 的參數上限，見測試）
  const entries = await db
    .select({
      id: holds.id,
      slotId: holds.slotId,
      status: holds.status,
      memberName: user.name,
      seats: holds.seats,
      expiresAt: holds.expiresAt,
      cancelledBy: holds.cancelledBy,
      cancelledAt: holds.cancelledAt,
    })
    .from(holds)
    .leftJoin(user, eq(user.id, holds.memberId))
    .where(
      and(
        inArray(holds.slotId, db.select({ id: slots.id }).from(slots).where(inAgenda)),
        sql`(${holds.status} IN (${CONFIRMED}, ${CANCELLED}) OR ${activeHold(now)})`,
      ),
    )
    .orderBy(asc(holds.createdAt), asc(holds.id));

  const entriesBySlot = new Map<number, typeof entries>();
  for (const entry of entries) {
    entriesBySlot.set(entry.slotId, [...(entriesBySlot.get(entry.slotId) ?? []), entry]);
  }

  return rows.map((row) => {
    const own = entriesBySlot.get(row.id) ?? [];
    const listed = ({ id, memberName, seats }: (typeof own)[number]) => ({ id, memberName, seats });
    const result: AgendaSlot = { ...withSeatSummary(row), bookings: [], holds: [], cancelledBookings: [] };
    for (const entry of own) {
      if (entry.status === CONFIRMED) {
        result.bookings.push(listed(entry));
      } else if (entry.status === CANCELLED) {
        result.cancelledBookings.push({ ...listed(entry), cancelledBy: entry.cancelledBy, cancelledAt: entry.cancelledAt });
      } else if (entry.status === HELD) {
        // SQL 已只留下有效保留（activeHold），所以 held 在這裡一定是有效的，不在 TS 重新判斷到期
        result.holds.push({ ...listed(entry), expiresAt: entry.expiresAt });
      }
    }
    return result;
  });
}

/** 刪除失敗後的唯讀診斷：只用來決定回哪個 reason。 */
export async function slotExists(db: DrizzleD1Database, slotId: number): Promise<boolean> {
  const rows = await db.select({ id: slots.id }).from(slots).where(eq(slots.id, slotId)).limit(1);
  return rows.length > 0;
}
