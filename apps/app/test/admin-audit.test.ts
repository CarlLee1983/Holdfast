import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { countRows, resetDb } from "./db";

const app = exports.default;
let jwt: string;

async function insertAudit(at: number, action = "resource.create"): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO admin_audit (actor_email, action, target_type, target_id, at, detail) VALUES (?, ?, 'resource', 1, ?, ?) RETURNING id",
  ).bind("admin@example.com", action, at, JSON.stringify({ at })).first<{ id: number }>();
  return row!.id;
}

async function clockRows(): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM clock").first<{ n: number }>())!.n;
}

beforeEach(async () => {
  await resetDb();
  setNow(Date.UTC(2030, 0, 1));
  jwt = await mintAccessJwt();
});

describe("listAuditForAdmin", () => {
  it("uses descending IDs even when timestamps are equal or move backwards, and returns the raw detail", async () => {
    const ids = [await insertAudit(300), await insertAudit(300), await insertAudit(100)];
    const result = await app.listAuditForAdmin(jwt, {});
    expect(result.ok && result.data.rows.map((row) => row.id)).toEqual(ids.reverse());
    expect(result.ok && result.data.rows[0]).toMatchObject({
      actorEmail: "admin@example.com", action: "resource.create", targetType: "resource",
      targetId: 1, at: 100, detail: '{"at":100}',
    });
    expect(result.ok && result.data.nextCursor).toBeNull();
    expect(await countRows("admin_audit")).toBe(3);
    expect(await clockRows()).toBe(0);
  });

  it("returns no cursor at exactly 50 rows and the last shown ID at 51", async () => {
    for (let i = 0; i < 50; i++) await insertAudit(i);
    const exactly = await app.listAuditForAdmin(jwt, {});
    expect(exactly.ok && exactly.data.rows).toHaveLength(50);
    expect(exactly.ok && exactly.data.nextCursor).toBeNull();
    await insertAudit(50);
    const extra = await app.listAuditForAdmin(jwt, {});
    expect(extra.ok && extra.data.rows).toHaveLength(50);
    expect(extra.ok && extra.data.nextCursor).toBe(extra.ok && extra.data.rows[49]!.id);
    const last = await app.listAuditForAdmin(jwt, { cursor: extra.ok ? extra.data.nextCursor : null });
    expect(last.ok && last.data.rows).toHaveLength(1);
    expect(last.ok && last.data.nextCursor).toBeNull();
  });

  it("walks multiple pages without duplicates despite ID gaps and newer inserts", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 106; i++) ids.push(await insertAudit(i % 2));
    await env.DB.prepare("DELETE FROM admin_audit WHERE id = ?").bind(ids[35]).run();
    const first = await app.listAuditForAdmin(jwt, {});
    expect(first.ok).toBe(true);
    await insertAudit(999);
    const seen = [...(first.ok ? first.data.rows.map((row) => row.id) : [])];
    let cursor = first.ok ? first.data.nextCursor : null;
    while (cursor !== null) {
      const page = await app.listAuditForAdmin(jwt, { cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) break;
      seen.push(...page.data.rows.map((row) => row.id));
      cursor = page.data.nextCursor;
    }
    expect(seen).toEqual(ids.filter((id) => id !== ids[35]).reverse());
    expect(new Set(seen).size).toBe(seen.length);
    expect(await countRows("admin_audit")).toBe(106);
    expect(await clockRows()).toBe(0);
  });

  it("rejects malformed cursors, and checks JWT before input", async () => {
    for (const cursor of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(await app.listAuditForAdmin(jwt, { cursor })).toMatchObject({ ok: false, reason: "invalid_input" });
    }
    expect(await app.listAuditForAdmin("", { cursor: "bad" })).toEqual({ ok: false, reason: "unauthorized" });
    expect(await countRows("admin_audit")).toBe(0);
    expect(await clockRows()).toBe(0);
  });
});
