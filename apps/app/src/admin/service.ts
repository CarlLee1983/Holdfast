import { drizzle } from "drizzle-orm/d1";
import { resourceExists, selectResources, type ResourceSummary } from "../catalog/queries";
import type { Clock } from "../shared/clock";
import { fail, ok, type InvalidInput, type Result } from "../shared/result";
import {
  createAccessVerifier,
  type AccessConfig,
  type AccessIdentity,
} from "./access";
import {
  createResourceInput,
  createSlotInput,
  parseInput,
  updateResourceInput,
} from "./input";

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

interface AuditEntry {
  action: string;
  targetType: "resource" | "slot";
  detail: unknown;
}

// 稽核紀錄的 target_id 由呼叫端提供 SQL 片段：新建立的列用 last_insert_rowid()，既有的列用綁定參數
const AUDIT_COLUMNS = "actor_email, action, target_type, target_id, at, detail";

export function createAdminService(d1: D1Database, clock: Clock, accessConfig: AccessConfig) {
  const db = drizzle(d1);
  const verifier = createAccessVerifier(accessConfig, clock);

  /** 一句 INSERT 寫稽核；`guard` 讓它只在前一句真的寫入時才執行（同一個 batch 內，changes() 指前一句）。 */
  function auditStatement(
    actor: AccessIdentity,
    entry: AuditEntry,
    targetId: number | "last_insert_rowid",
    guarded: boolean,
  ) {
    const target = targetId === "last_insert_rowid" ? "last_insert_rowid()" : "?";
    const binds: (string | number)[] = [actor.email, entry.action, entry.targetType];
    if (targetId !== "last_insert_rowid") binds.push(targetId);
    binds.push(clock.now(), JSON.stringify(entry.detail));
    return d1
      .prepare(
        `INSERT INTO admin_audit (${AUDIT_COLUMNS}) SELECT ?, ?, ?, ${target}, ?, ? ${
          guarded ? "WHERE changes() > 0" : ""
        }`,
      )
      .bind(...binds);
  }

  /** Workers Logs 的結構化一行；只在寫入成功後才呼叫。 */
  function logAudit(actor: AccessIdentity, entry: AuditEntry, targetId: number) {
    console.log(
      JSON.stringify({
        event: "admin_audit",
        actor: actor.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId,
        at: clock.now(),
        detail: entry.detail,
      }),
    );
  }

  return {
    async listResourcesForAdmin(jwt: unknown): Promise<AdminResult<ResourceSummary[]>> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      return ok(await selectResources(db));
    },

    async createResource(jwt: unknown, input: unknown): Promise<AdminResult<ResourceSummary>> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      const parsed = parseInput(createResourceInput, input);
      if (!parsed.ok) return parsed;
      const data = parsed.data;

      const entry: AuditEntry = { action: "resource.create", targetType: "resource", detail: data };
      const [insert] = await d1.batch<{ id: number }>([
        d1
          .prepare(
            "INSERT INTO resources (name, hold_ttl_seconds, seats_per_hold, cancellation_cutoff_seconds) VALUES (?, ?, ?, ?) RETURNING id",
          )
          .bind(data.name, data.holdTtlSeconds, data.seatsPerHold, data.cancellationCutoffSeconds),
        auditStatement(auth.data, entry, "last_insert_rowid", false),
      ]);
      const id = insert!.results[0]!.id;
      logAudit(auth.data, entry, id);
      return ok({ id, ...data });
    },

    async updateResource(
      jwt: unknown,
      input: unknown,
    ): Promise<AdminResult<ResourceSummary, "resource_not_found">> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      const parsed = parseInput(updateResourceInput, input);
      if (!parsed.ok) return parsed;
      const { id, ...fields } = parsed.data;

      const entry: AuditEntry = { action: "resource.update", targetType: "resource", detail: fields };
      const [update] = await d1.batch([
        d1
          .prepare(
            "UPDATE resources SET name = ?, hold_ttl_seconds = ?, seats_per_hold = ?, cancellation_cutoff_seconds = ? WHERE id = ?",
          )
          .bind(fields.name, fields.holdTtlSeconds, fields.seatsPerHold, fields.cancellationCutoffSeconds, id),
        auditStatement(auth.data, entry, id, true),
      ]);
      if (update!.meta.changes === 0) return fail("resource_not_found");
      logAudit(auth.data, entry, id);
      return ok({ id, ...fields });
    },

    async createSlot(
      jwt: unknown,
      input: unknown,
    ): Promise<AdminResult<SlotRecord, "resource_not_found" | "slot_overlaps">> {
      const auth = await verifier.verify(jwt);
      if (!auth.ok) return auth;
      const parsed = parseInput(createSlotInput, input);
      if (!parsed.ok) return parsed;
      const slot = parsed.data;

      // 重疊檢查與寫入是同一句 INSERT … SELECT（ADR 0004 的做法），以 meta.changes 判斷成敗，
      // 不先讀再寫；[start, end) 相交 ⇔ 既有.start < 新.end 且 既有.end > 新.start，相鄰不算相交
      const entry: AuditEntry = { action: "slot.create", targetType: "slot", detail: slot };
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
        auditStatement(auth.data, entry, "last_insert_rowid", true),
      ]);
      if (insert!.meta.changes === 0) {
        // 寫入失敗之後才分辨原因（只用來選 reason，不影響是否寫入）
        return (await resourceExists(db, slot.resourceId))
          ? fail("slot_overlaps")
          : fail("resource_not_found");
      }
      const id = insert!.meta.last_row_id;
      logAudit(auth.data, entry, id);
      return ok({ id, ...slot });
    },
  };
}
