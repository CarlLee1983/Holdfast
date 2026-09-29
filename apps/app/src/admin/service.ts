import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";
import { resourceExists, selectResources, type ResourceSummary } from "../catalog/queries";
import type { Clock } from "../shared/clock";
import { fail, ok, type InvalidInput, type Result } from "../shared/result";
import { createAccessVerifier, type AccessConfig, type AccessIdentity } from "./access";
import { parseInput } from "../shared/input";
import { createResourceInput, createSlotInput, updateResourceInput } from "./input";

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
  };
}
