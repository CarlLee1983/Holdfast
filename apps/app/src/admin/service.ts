import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { z } from "zod";
import { resourceExists, selectResources, type ResourceSummary } from "../catalog/queries";
import type { Clock } from "../shared/clock";
import { fail, ok, type InvalidInput, type Result } from "../shared/result";
import { createAccessVerifier, type AccessConfig, type AccessIdentity } from "./access";
import { parseInput } from "../shared/input";
import { activeHoldOrBooking } from "../holds/occupancy";
import { createResourceInput, createSlotInput, deleteSlotInput, updateResourceInput, updateSlotCapacityInput } from "./input";
import { selectAdminSlots, slotExists, type AdminSlot } from "./queries";

export interface SlotRecord {
  id: number;
  resourceId: number;
  startsAt: number;
  endsAt: number;
  capacity: number;
}

type AdminResult<T, Reason extends string = never> =
  | Result<T, Reason | "unauthorized">
  | InvalidInput;

const AUDIT_COLUMNS = "actor_email, action, target_type, target_id, at, detail";

const dialect = new SQLiteSyncDialect();

export function createAdminService(d1: D1Database, clock: Clock, accessConfig: AccessConfig) {
  const db = drizzle(d1);
  const verifier = createAccessVerifier(accessConfig, clock);

  /** 每個管理寫入方法的共同前置：先驗身分、再驗輸入，兩者都過了才執行 `run`。 */
  async function authorizedWrite<S extends z.ZodType, T>(
    jwt: unknown,
    schema: S,
    input: unknown,
    run: (actor: AccessIdentity, data: z.output<S>) => Promise<T>,
  ): Promise<T | InvalidInput | { ok: false; reason: "unauthorized" }> {
    const auth = await verifier.verify(jwt);
    if (!auth.ok) return auth;
    const parsed = parseInput(schema, input);
    if (!parsed.ok) return parsed;
    return run(auth.data, parsed.data);
  }

  /**
   * 稽核 INSERT，接在「新增一列」的語句之後放進同一個 batch：
   * target_id 取 last_insert_rowid()，且只在前一句真的寫入時才執行。
   *
   * `changes() > 0` 的守衛——已實測（admin.test.ts：重疊被拒絕時不產生稽核列，成功時恰好一列）。
   */
  function auditAfterInsert(
    actor: AccessIdentity,
    action: string,
    targetType: "resource" | "slot",
    detail: unknown,
  ) {
    return d1
      .prepare(
        `INSERT INTO admin_audit (${AUDIT_COLUMNS})
         SELECT ?1, ?2, ?3, last_insert_rowid(), ?4, ?5 WHERE changes() > 0`,
      )
      .bind(actor.email, action, targetType, clock.now(), JSON.stringify(detail));
  }

  /**
   * 修改資源的稽核 INSERT，必須放在 UPDATE 之前：同一個 batch 內先以 INSERT … SELECT
   * 讀出舊值（before）連同新值（after）寫成 detail，再由後面的 UPDATE 改資料。
   * 資源不存在時 SELECT 不出列，因此不會寫稽核。RETURNING 把 detail 帶回來供 log 使用。
   */
  function auditResourceUpdateBeforeWrite(
    actor: AccessIdentity,
    resourceId: number,
    after: unknown,
  ) {
    return d1
      .prepare(
        `INSERT INTO admin_audit (${AUDIT_COLUMNS})
         SELECT ?1, 'resource.update', 'resource', id, ?2,
           json_object(
             'before', json_object(
               'name', name,
               'holdTtlSeconds', hold_ttl_seconds,
               'seatsPerHold', seats_per_hold,
               'cancellationCutoffSeconds', cancellation_cutoff_seconds
             ),
             'after', json(?3)
           )
         FROM resources WHERE id = ?4
         RETURNING detail`,
      )
      .bind(actor.email, clock.now(), JSON.stringify(after), resourceId);
  }

  /** 把 drizzle 的 SQL 片段組成 D1 語句，才能與其他語句放進同一個 `d1.batch`（drizzle 的 `db.run` 不能進 D1 batch）。 */
  function statement(query: SQL) {
    const { sql: text, params } = dialect.sqlToQuery(query);
    return d1.prepare(text).bind(...params);
  }

  /** 「時段沒有任何有效保留或訂位」的條件片段；刪除的稽核與刪除語句共用同一份，判定不會分歧。 */
  const slotHasNoActiveHold = (slotId: number) =>
    sql`NOT EXISTS (SELECT 1 FROM holds WHERE slot_id = ${slotId} AND ${activeHoldOrBooking(clock.now())})`;

  /** Workers Logs 的結構化一行；只在寫入成功後才呼叫。 */
  function logAudit(
    actor: AccessIdentity,
    action: string,
    targetType: string,
    targetId: number,
    detail: unknown,
  ) {
    console.log(
      JSON.stringify({
        event: "admin_audit",
        actor: actor.email,
        action,
        targetType,
        targetId,
        at: clock.now(),
        detail,
      }),
    );
  }

  return {
    async listResourcesForAdmin(jwt: unknown): Promise<AdminResult<ResourceSummary[]>> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      return ok(await selectResources(db));
    },

    createResource(jwt: unknown, input: unknown): Promise<AdminResult<ResourceSummary>> {
      return authorizedWrite(jwt, createResourceInput, input, async (actor, data) => {
        const [insert] = await d1.batch<{ id: number }>([
          d1
            .prepare(
              "INSERT INTO resources (name, hold_ttl_seconds, seats_per_hold, cancellation_cutoff_seconds) VALUES (?, ?, ?, ?) RETURNING id",
            )
            .bind(data.name, data.holdTtlSeconds, data.seatsPerHold, data.cancellationCutoffSeconds),
          auditAfterInsert(actor, "resource.create", "resource", data),
        ]);
        const id = insert!.results[0]!.id;
        logAudit(actor, "resource.create", "resource", id, data);
        return ok({ id, ...data });
      });
    },

    updateResource(
      jwt: unknown,
      input: unknown,
    ): Promise<AdminResult<ResourceSummary, "resource_not_found">> {
      return authorizedWrite(jwt, updateResourceInput, input, async (actor, data) => {
        const { id, ...fields } = data;
        // 順序固定：稽核（讀舊值）在前，UPDATE 在後
        const [audit, update] = await d1.batch<{ detail: string }>([
          auditResourceUpdateBeforeWrite(actor, id, fields),
          d1
            .prepare(
              "UPDATE resources SET name = ?, hold_ttl_seconds = ?, seats_per_hold = ?, cancellation_cutoff_seconds = ? WHERE id = ?",
            )
            .bind(fields.name, fields.holdTtlSeconds, fields.seatsPerHold, fields.cancellationCutoffSeconds, id),
        ]);
        if (update!.meta.changes === 0) return fail("resource_not_found");
        logAudit(actor, "resource.update", "resource", id, JSON.parse(audit!.results[0]!.detail));
        return ok({ id, ...fields });
      });
    },

    createSlot(
      jwt: unknown,
      input: unknown,
    ): Promise<AdminResult<SlotRecord, "resource_not_found" | "slot_overlaps">> {
      return authorizedWrite(jwt, createSlotInput, input, async (actor, slot) => {
        // 重疊檢查與寫入是同一句 INSERT … SELECT（ADR 0004 的做法），以 meta.changes 判斷成敗，
        // 不先讀再寫；[start, end) 相交 ⇔ 既有.start < 新.end 且 既有.end > 新.start，相鄰不算相交
        const [insert] = await d1.batch([
          d1
            .prepare(
              `INSERT INTO slots (resource_id, starts_at, ends_at, capacity)
               SELECT ?1, ?2, ?3, ?4
               WHERE EXISTS (SELECT 1 FROM resources WHERE id = ?1)
                 AND NOT EXISTS (
                   SELECT 1 FROM slots WHERE resource_id = ?1 AND starts_at < ?3 AND ends_at > ?2
                 )`,
            )
            .bind(slot.resourceId, slot.startsAt, slot.endsAt, slot.capacity),
          auditAfterInsert(actor, "slot.create", "slot", slot),
        ]);
        if (insert!.meta.changes === 0) {
          // 寫入失敗之後才分辨原因（只用來選 reason，不影響是否寫入）
          return (await resourceExists(db, slot.resourceId))
            ? fail("slot_overlaps")
            : fail("resource_not_found");
        }
        const id = insert!.meta.last_row_id;
        logAudit(actor, "slot.create", "slot", id, slot);
        return ok({ id, ...slot });
      });
    },

    async listSlotsForAdmin(
      jwt: unknown,
      resourceId: number,
    ): Promise<AdminResult<AdminSlot[], "resource_not_found">> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      if (!(await resourceExists(db, resourceId))) return fail("resource_not_found");
      return ok(await selectAdminSlots(db, resourceId, clock.now()));
    },

    updateSlotCapacity(
      jwt: unknown,
      input: unknown,
    ): Promise<AdminResult<SlotRecord, "slot_not_found">> {
      return authorizedWrite(jwt, updateSlotCapacityInput, input, async (actor, { slotId, capacity }) => {
        // 不檢查已占用：調到低於占用就是超占，由「占用 > 容量」即時算出，不存旗標。
        // 稽核（讀舊容量）在前、UPDATE 在後；時段不存在時兩句都不影響任何列
        const [, update] = await d1.batch<{
          id: number;
          resource_id: number;
          starts_at: number;
          ends_at: number;
        }>([
          d1
            .prepare(
              `INSERT INTO admin_audit (${AUDIT_COLUMNS})
               SELECT ?1, 'slot.update_capacity', 'slot', id, ?2,
                 json_object('before', json_object('capacity', capacity), 'after', json_object('capacity', ?3))
               FROM slots WHERE id = ?4`,
            )
            .bind(actor.email, clock.now(), capacity, slotId),
          d1
            .prepare("UPDATE slots SET capacity = ? WHERE id = ? RETURNING id, resource_id, starts_at, ends_at")
            .bind(capacity, slotId),
        ]);
        const row = update!.results[0];
        if (!row) return fail("slot_not_found");
        logAudit(actor, "slot.update_capacity", "slot", slotId, { after: { capacity } });
        return ok({
          id: row.id,
          resourceId: row.resource_id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          capacity,
        });
      });
    },

    deleteSlot(jwt: unknown, input: unknown): Promise<AdminResult<{ id: number }, "slot_not_found" | "slot_in_use">> {
      return authorizedWrite(jwt, deleteSlotInput, input, async (actor, { slotId }) => {
        // 「沒有有效保留或訂位」的判定與刪除在同一個 batch（同一交易）內以條件寫入完成（ADR 0004），
        // 不先讀再刪。順序固定：稽核（讀時段內容）→ 移除已失效的保留紀錄（外鍵要求）→ 刪時段；
        // 三句共用同一個條件，所以要嘛全部生效、要嘛都不動，成敗看最後一句的 changes
        const [, , deletion] = await d1.batch([
          statement(sql`
            INSERT INTO admin_audit (actor_email, action, target_type, target_id, at, detail)
            SELECT ${actor.email}, 'slot.delete', 'slot', id, ${clock.now()},
              json_object('resourceId', resource_id, 'startsAt', starts_at, 'endsAt', ends_at, 'capacity', capacity)
            FROM slots WHERE id = ${slotId} AND ${slotHasNoActiveHold(slotId)}
          `),
          statement(sql`DELETE FROM holds WHERE slot_id = ${slotId} AND ${slotHasNoActiveHold(slotId)}`),
          statement(sql`DELETE FROM slots WHERE id = ${slotId} AND ${slotHasNoActiveHold(slotId)}`),
        ]);
        if (deletion!.meta.changes === 0) {
          // 失敗之後才分辨原因（只用來選 reason，不影響是否刪除）
          return (await slotExists(db, slotId)) ? fail("slot_in_use") : fail("slot_not_found");
        }
        logAudit(actor, "slot.delete", "slot", slotId, { slotId });
        return ok({ id: slotId });
      });
    },
  };
}
