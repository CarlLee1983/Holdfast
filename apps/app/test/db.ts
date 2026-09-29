import { env } from "cloudflare:workers";

const DEFAULT_SEATS_PER_HOLD = 4;
const DEFAULT_CANCELLATION_CUTOFF_SECONDS = 3600;

/** 每個測試前清空資料表（外鍵順序：先 slots 後 resources；session、account 先於 user）。 */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM session"),
    env.DB.prepare("DELETE FROM account"),
    env.DB.prepare("DELETE FROM verification"),
    env.DB.prepare('DELETE FROM "user"'),
    env.DB.prepare("DELETE FROM admin_audit"),
    env.DB.prepare("DELETE FROM slots"),
    env.DB.prepare("DELETE FROM resources"),
  ]);
}

interface ResourceRow {
  name: string;
  /** 不給就走 schema 預設值，藉此驗證預設 10 分鐘。 */
  holdTtlSeconds?: number;
  seatsPerHold?: number;
  cancellationCutoffSeconds?: number;
}

export async function insertResource(row: ResourceRow): Promise<number> {
  // hold_ttl_seconds 只在有值時才放進 INSERT，未給時由 schema 預設值填入
  const columns = ["name", "seats_per_hold", "cancellation_cutoff_seconds"];
  const values: (string | number)[] = [
    row.name,
    row.seatsPerHold ?? DEFAULT_SEATS_PER_HOLD,
    row.cancellationCutoffSeconds ?? DEFAULT_CANCELLATION_CUTOFF_SECONDS,
  ];
  if (row.holdTtlSeconds !== undefined) {
    columns.push("hold_ttl_seconds");
    values.push(row.holdTtlSeconds);
  }
  const result = await env.DB.prepare(
    `INSERT INTO resources (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`,
  )
    .bind(...values)
    .first<{ id: number }>();
  return result!.id;
}

export async function insertSlot(
  resourceId: number,
  startsAt: number,
  endsAt: number,
  capacity: number,
): Promise<number> {
  const result = await env.DB.prepare(
    "INSERT INTO slots (resource_id, starts_at, ends_at, capacity) VALUES (?, ?, ?, ?) RETURNING id",
  )
    .bind(resourceId, startsAt, endsAt, capacity)
    .first<{ id: number }>();
  return result!.id;
}

export async function countRows(table: "resources" | "slots" | "admin_audit"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row!.n;
}

export interface AuditRow {
  actor_email: string;
  action: string;
  target_type: string;
  target_id: number;
  at: number;
  detail: string;
}

export async function auditRows(): Promise<AuditRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT actor_email, action, target_type, target_id, at, detail FROM admin_audit ORDER BY id",
  ).all<AuditRow>();
  return results;
}
