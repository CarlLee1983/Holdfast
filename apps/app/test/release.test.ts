import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { setNow } from "./clock";
import { insertResource, insertSlot, insertUser, resetDb } from "./db";
import { AppEntrypoint } from "../src/entrypoint";

const NOW = Date.UTC(2030, 0, 1);
const TTL = 600_000;
const app = exports.default;

let resourceId: number;
let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  await Promise.all(["m1", "m2"].map(insertUser));
  resourceId = await insertResource({ name: "大廳", holdTtlSeconds: TTL / 1000 });
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

  it("到期前一刻完成的確認，不被之後才執行的釋放推翻：訂位仍列出、名額仍被占用", async () => {
    const confirmed = await createHold("m1", "confirmed");
    setNow(NOW + TTL - 1);
    expect((await app.confirmHold("m1", { holdId: confirmed })).ok).toBe(true);

    setNow(NOW + TTL + 60_000);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 0 } });
    expect(await status(confirmed)).toBe("confirmed");
    const bookings = await app.listMyBookings("m1");
    expect(bookings.ok && bookings.data.map((b) => b.id)).toEqual([confirmed]);
    const slots = await app.listSlots(resourceId);
    expect(slots.ok && slots.data[0]?.remainingSeats).toBe(9);
  });

  it("釋放之後，同一會員可立即對同一時段重新保留；已釋放的不再列為有效保留", async () => {
    const released = await createHold("m1", "old");
    setNow(NOW + TTL);
    await app.releaseExpiredHolds();

    const again = await createHold("m1", "new");
    const holds = await app.listMyHolds("m1");
    expect(holds.ok && holds.data.map((h) => h.id)).toEqual([again]);
    expect(await status(released)).toBe("released");
  });

  it("釋放先落地、帶到期前時間的確認晚到：確認不成立，保留維持已釋放（ADR 0011）", async () => {
    const id = await createHold("m1", "a");
    setNow(NOW + TTL);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 1 } });

    setNow(NOW + TTL - 1);
    expect(await app.confirmHold("m1", { holdId: id })).toEqual({ ok: false, reason: "hold_expired" });
    expect(await status(id)).toBe("released");
  });

  it("別的寫入已把時間推過到期，帶較早時間的釋放晚到：仍依有效時間釋放該保留（ADR 0011）", async () => {
    const id = await createHold("m1", "a");
    setNow(NOW + TTL);
    await createHold("m2", "b");

    setNow(NOW + TTL - 1);
    expect(await app.releaseExpiredHolds()).toEqual({ ok: true, data: { releasedCount: 1 } });
    expect(await status(id)).toBe("released");
  });

  it("scheduled event invokes the release method", async () => {
    const expired = await createHold("m1", "cron");
    setNow(NOW + TTL);

    const worker = new AppEntrypoint(createExecutionContext(), env);
    await worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: new Date(NOW + TTL) }));

    expect(await status(expired)).toBe("released");
  });
});
