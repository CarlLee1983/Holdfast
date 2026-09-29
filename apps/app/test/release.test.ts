import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { setNow } from "./clock";
import { insertResource, insertSlot, resetDb } from "./db";
import { AppEntrypoint } from "../src/entrypoint";

const NOW = Date.UTC(2030, 0, 1);
const TTL = 600_000;
const app = exports.default;

let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  const resourceId = await insertResource({ name: "大廳", holdTtlSeconds: TTL / 1000 });
  slotId = await insertSlot(resourceId, NOW + 3_600_000, NOW + 7_200_000, 10);
});

async function createHold(memberId: string, key: string): Promise<number> {
  const result = await app.createHold(memberId, { slotId, seats: 1, idempotencyKey: key });
  if (!result.ok) throw new Error(result.reason);
  return result.data.id;
}

async function status(id: number): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM holds WHERE id = ?").bind(id).first<{ status: string }>();
  return row!.status;
}

describe("releaseExpiredHolds", () => {
  it("只釋放到期的 held，重複及延遲執行都不再改變狀態", async () => {
    const expired = await createHold("m1", "expired");
    setNow(NOW + 1);
    const current = await createHold("m2", "current");

    setNow(NOW + TTL - 1);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 0 } });
    expect(await status(expired)).toBe("held");

    setNow(NOW + TTL);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 1 } });
    expect(await status(expired)).toBe("released");
    expect(await status(current)).toBe("held");

    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 0 } });
    setNow(NOW + TTL + 1);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 1 } });
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 0 } });
  });

  it("已確認的保留在到期後也保持 confirmed", async () => {
    const confirmed = await createHold("m1", "confirmed");
    setNow(NOW + TTL - 1);
    await env.DB.prepare("UPDATE holds SET status = 'confirmed' WHERE id = ?").bind(confirmed).run();

    setNow(NOW + TTL + 60_000);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 0 } });
    expect(await status(confirmed)).toBe("confirmed");
  });

  it("scheduled event invokes the release method", async () => {
    const expired = await createHold("m1", "cron");
    setNow(NOW + TTL);

    const worker = new AppEntrypoint(createExecutionContext(), env);
    await worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: new Date(NOW + TTL) }));

    expect(await status(expired)).toBe("released");
  });
});
