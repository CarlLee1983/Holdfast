import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { insertResource, insertSlot, insertUser, resetDb } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1);
const CUTOFF_SECONDS = 3600;
const STARTS_AT = NOW + 5 * HOUR;
/** 取消截止時刻 = 時段開始 - 取消截止秒數。 */
const CUTOFF = STARTS_AT - CUTOFF_SECONDS * 1000;

const app = exports.default;

let resourceId: number;
let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  await Promise.all(["m1", "m2", "m3"].map(insertUser));
  resourceId = await insertResource({
    name: "大廳",
    holdTtlSeconds: 600,
    seatsPerHold: 4,
    cancellationCutoffSeconds: CUTOFF_SECONDS,
  });
  slotId = await insertSlot(resourceId, STARTS_AT, STARTS_AT + HOUR, 10);
});

/** 建立並確認一筆訂位，回傳訂位編號。 */
async function book(member: string, key: string, seats = 2, slot = slotId): Promise<number> {
  const created = await app.createHold(member, { slotId: slot, seats, idempotencyKey: key });
  if (!created.ok) throw new Error(`建立保留失敗：${created.reason}`);
  const confirmed = await app.confirmHold(member, { holdId: created.data.id });
  if (!confirmed.ok) throw new Error(`確認失敗：${confirmed.reason}`);
  return created.data.id;
}

async function remaining(): Promise<number> {
  const result = await app.listSlots(resourceId);
  if (!result.ok) throw new Error(result.reason);
  return result.data.find((s) => s.id === slotId)!.remainingSeats;
}

async function bookings(member: string) {
  const result = await app.listMyBookings(member);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

async function activeHolds(member: string) {
  const result = await app.listMyHolds(member);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

describe("cancelBooking", () => {
  it("截止前取消成功：回傳訂位與取消時間，名額立即回到時段，訂位離開列表", async () => {
    const id = await book("m1", "k");
    expect(await remaining()).toBe(8);
    setNow(NOW + 1000);

    expect(await app.cancelBooking("m1", { bookingId: id })).toEqual({
      ok: true,
      data: { id, slotId, seats: 2, cancelledAt: NOW + 1000 },
    });
    expect(await remaining()).toBe(10);
    expect(await bookings("m1")).toEqual([]);
    expect(await app.confirmHold("m1", { holdId: id })).toEqual({ ok: false, reason: "booking_cancelled" });
  });

  it("取消後同一會員可以立刻重新保留同一時段", async () => {
    const id = await book("m1", "k");
    await app.cancelBooking("m1", { bookingId: id });

    const again = await app.createHold("m1", { slotId, seats: 2, idempotencyKey: "k2" });

    expect(again.ok).toBe(true);
  });

  it("剛好在截止時刻仍可取消（最後時點）；晚 1 毫秒被拒絕；時段開始後也被拒絕", async () => {
    const a = await book("m1", "a", 1);
    const b = await book("m2", "b", 1);
    const c = await book("m3", "c", 1);

    setNow(CUTOFF);
    expect((await app.cancelBooking("m1", { bookingId: a })).ok).toBe(true);

    setNow(CUTOFF + 1);
    expect(await app.cancelBooking("m2", { bookingId: b })).toEqual({
      ok: false,
      reason: "cancellation_cutoff_passed",
    });

    setNow(STARTS_AT + 1);
    expect(await app.cancelBooking("m3", { bookingId: c })).toEqual({
      ok: false,
      reason: "cancellation_cutoff_passed",
    });
    expect((await bookings("m2")).map((x) => x.id)).toEqual([b]);
    expect((await bookings("m3")).map((x) => x.id)).toEqual([c]);
  });

  it("使用資源目前的取消截止設定（不做快照）", async () => {
    const id = await book("m1", "k");
    const updated = await app.updateResource(await mintAccessJwt(), {
      id: resourceId,
      name: "大廳",
      holdTtlSeconds: 600,
      seatsPerHold: 4,
      cancellationCutoffSeconds: 4 * 3600,
    });
    expect(updated.ok).toBe(true);
    setNow(STARTS_AT - 3 * HOUR);

    expect(await app.cancelBooking("m1", { bookingId: id })).toEqual({
      ok: false,
      reason: "cancellation_cutoff_passed",
    });
  });

  it("別人的訂位：booking_not_found，訂位不受影響", async () => {
    const id = await book("m1", "k");

    expect(await app.cancelBooking("m2", { bookingId: id })).toEqual({ ok: false, reason: "booking_not_found" });
    expect((await bookings("m1")).map((x) => x.id)).toEqual([id]);
    expect(await remaining()).toBe(8);
  });

  it("不存在的編號：booking_not_found", async () => {
    expect(await app.cancelBooking("m1", { bookingId: 999_999 })).toEqual({
      ok: false,
      reason: "booking_not_found",
    });
  });

  it("仍是保留中或已釋放的保留不是訂位：booking_not_found，狀態不變", async () => {
    const expired = await app.createHold("m1", { slotId, seats: 1, idempotencyKey: "r" });
    if (!expired.ok) throw new Error("建立保留失敗");
    setNow(NOW + 600_000);
    await app.releaseExpiredHolds();
    const stillHeld = await app.createHold("m2", { slotId, seats: 1, idempotencyKey: "h" });
    if (!stillHeld.ok) throw new Error("建立保留失敗");

    expect(await app.cancelBooking("m1", { bookingId: expired.data.id })).toEqual({
      ok: false,
      reason: "booking_not_found",
    });
    expect(await app.confirmHold("m1", { holdId: expired.data.id })).toEqual({ ok: false, reason: "hold_expired" });
    expect(await app.cancelBooking("m2", { bookingId: stillHeld.data.id })).toEqual({
      ok: false,
      reason: "booking_not_found",
    });
    expect((await activeHolds("m2")).map((x) => x.id)).toEqual([stillHeld.data.id]);
  });

  it("重複取消（冪等）：回同一筆訂位，cancelledAt 不變，即使之後已過截止時間", async () => {
    const id = await book("m1", "k");
    setNow(NOW + 1000);
    const first = await app.cancelBooking("m1", { bookingId: id });
    setNow(CUTOFF + HOUR / 2);

    const second = await app.cancelBooking("m1", { bookingId: id });

    expect(second).toEqual(first);
    expect(second).toMatchObject({ ok: true, data: { cancelledAt: NOW + 1000 } });
  });

  it("確認已取消的訂位：booking_cancelled", async () => {
    const id = await book("m1", "k");
    await app.cancelBooking("m1", { bookingId: id });

    expect(await app.confirmHold("m1", { holdId: id })).toEqual({ ok: false, reason: "booking_cancelled" });
  });

  it("釋放不動已取消的列", async () => {
    const id = await book("m1", "k");
    await app.cancelBooking("m1", { bookingId: id });
    setNow(NOW + 10 * HOUR);

    await app.releaseExpiredHolds();

    expect(await app.confirmHold("m1", { holdId: id })).toEqual({ ok: false, reason: "booking_cancelled" });
  });

  it("listMyBookings 帶 cancellableUntil = 開始時間 - 取消截止秒數", async () => {
    const id = await book("m1", "k");

    expect(await bookings("m1")).toEqual([
      {
        id,
        slotId,
        resourceName: "大廳",
        startsAt: STARTS_AT,
        endsAt: STARTS_AT + HOUR,
        seats: 2,
        status: "confirmed",
        cancelledAt: null,
        cancelledBy: null,
        cancellableUntil: CUTOFF,
      },
    ]);
  });

  it.each([
    ["缺少 bookingId", {}],
    ["bookingId 為 0", { bookingId: 0 }],
    ["bookingId 為負數", { bookingId: -1 }],
    ["bookingId 不是整數", { bookingId: 1.5 }],
    ["bookingId 是文字", { bookingId: "1" }],
    ["input 不是物件", null],
  ])("%s：invalid_input", async (_label, input) => {
    expect(await app.cancelBooking("m1", input)).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("memberId 空字串：invalid_input", async () => {
    expect(await app.cancelBooking("", { bookingId: 1 })).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("同一會員 5 個併發取消：全部成功，只發生一次狀態變更（cancelledAt 相同）", async () => {
    const id = await book("m1", "k");
    setNow(NOW + 1000);

    const results = await Promise.all(Array.from({ length: 5 }, () => app.cancelBooking("m1", { bookingId: id })));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.data.cancelledAt : null)))).toEqual(new Set([NOW + 1000]));
    expect(await remaining()).toBe(10);
  });
});
