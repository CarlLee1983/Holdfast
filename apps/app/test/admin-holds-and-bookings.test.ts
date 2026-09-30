import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, insertResource, insertSlot, insertUser, resetDb } from "./db";

const NOW = Date.UTC(2030, 0, 1);
const HOUR = 3_600_000;
const app = exports.default;
let jwt: string;
let slotId: number;
let resourceId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
  resourceId = await insertResource({ name: "大廳", seatsPerHold: 2 });
  slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 2);
});

async function hold(memberId: string, key: string) {
  const result = await app.createHold(memberId, { slotId, seats: 2, idempotencyKey: key });
  expect(result.ok).toBe(true);
  return result.ok ? result.data.id : -1;
}

describe("admin holds and bookings", () => {
  it("verifies JWT before reading or writing and validates identifiers", async () => {
    expect(await app.listSlotHoldsAndBookingsForAdmin("bad", { slotId })).toEqual({ ok: false, reason: "unauthorized" });
    expect(await app.cancelBookingForAdmin("bad", { slotId, bookingId: 1 })).toEqual({ ok: false, reason: "unauthorized" });
    expect(await app.listSlotHoldsAndBookingsForAdmin(jwt, { slotId: 0 })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId: 0 })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await app.listSlotHoldsAndBookingsForAdmin(jwt, { slotId: 999 })).toEqual({ ok: false, reason: "slot_not_found" });
    expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId: 999 })).toEqual({ ok: false, reason: "booking_not_found" });
    expect(await auditRows()).toHaveLength(0);
  });

  it("lists historical rows, effective expiry, and member identity even after account deletion", async () => {
    await env.DB.prepare('INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind("m1", "Alice", "alice@example.com", NOW, NOW).run();
    const first = await hold("m1", "first");
    const withAccount = await app.listSlotHoldsAndBookingsForAdmin(jwt, { slotId });
    expect(withAccount.ok && withAccount.data.holdsAndBookings[0]).toMatchObject({ memberName: "Alice", memberEmail: "alice@example.com" });
    setNow(NOW + 601_000);
    const second = await hold("m2", "second");
    await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind("m1").run();

    const result = await app.listSlotHoldsAndBookingsForAdmin(jwt, { slotId });
    expect(result).toMatchObject({ ok: true, data: { slot: { id: slotId, resourceName: "大廳", capacity: 2 } } });
    if (!result.ok) return;
    expect(result.data.holdsAndBookings).toMatchObject([
      { id: first, memberId: "m1", memberName: null, memberEmail: null, status: "expired" },
      { id: second, memberId: "m2", memberName: null, memberEmail: null, status: "held" },
    ]);
  });

  it("cancels after the cutoff, immediately returns capacity, and shows member cancellation", async () => {
    await insertUser("m1");
    const first = await hold("m1", "first");
    expect((await app.confirmHold("m1", { holdId: first })).ok).toBe(true);
    setNow(NOW + HOUR - 1000);
    const before = await app.listSlots(resourceId);
    expect(before.ok && before.data[0]?.remainingSeats).toBe(0);
    const cancelled = await app.cancelBookingForAdmin(jwt, { slotId, bookingId: first });
    expect(cancelled).toEqual({ ok: true, data: { id: first, slotId, seats: 2 } });
    const after = await app.listSlots(resourceId);
    expect(after.ok && after.data[0]?.remainingSeats).toBe(2);
    const bookings = await app.listMyBookings("m1");
    expect(bookings.ok && bookings.data).toMatchObject([{ id: first, status: "cancelled", cancelledAt: NOW + HOUR - 1000, cancelledBy: "admin" }]);
    expect(await app.confirmHold("m1", { holdId: first })).toEqual({ ok: false, reason: "booking_cancelled" });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: ADMIN_EMAIL, action: "booking.cancel", target_type: "booking", target_id: first });
  });

  it("writes exactly one audit for concurrent and repeated cancellations", async () => {
    await insertUser("m1");
    const bookingId = await hold("m1", "first");
    await app.confirmHold("m1", { holdId: bookingId });
    const results = await Promise.all(Array.from({ length: 4 }, () => app.cancelBookingForAdmin(jwt, { slotId, bookingId })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toMatchObject({ ok: true });
    expect(await auditRows()).toHaveLength(1);
  });

  it("does not cancel a booking from another slot", async () => {
    await insertUser("m1");
    const bookingId = await hold("m1", "first");
    await app.confirmHold("m1", { holdId: bookingId });
    const otherSlotId = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 2);
    const before = await app.listSlots(resourceId);

    expect(await app.cancelBookingForAdmin(jwt, { slotId: otherSlotId, bookingId })).toEqual({ ok: false, reason: "booking_not_found" });
    expect(await app.listMyBookings("m1")).toMatchObject({ ok: true, data: [{ id: bookingId, status: "confirmed" }] });
    expect(await app.listSlots(resourceId)).toEqual(before);
    expect(await auditRows()).toHaveLength(0);

    expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toMatchObject({ ok: true });
    expect(await app.cancelBookingForAdmin(jwt, { slotId: otherSlotId, bookingId })).toEqual({ ok: false, reason: "booking_not_found" });
    expect(await auditRows()).toHaveLength(1);
  });

  describe("cancellation reason and slot start", () => {
    async function confirmed(memberId = "m1") {
      await insertUser(memberId);
      const bookingId = await hold(memberId, `key-${memberId}`);
      expect((await app.confirmHold(memberId, { holdId: bookingId })).ok).toBe(true);
      return bookingId;
    }

    it("cancels one millisecond before the slot starts", async () => {
      const bookingId = await confirmed();
      setNow(NOW + HOUR - 1);
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toEqual({ ok: true, data: { id: bookingId, slotId, seats: 2 } });
    });

    it("refuses exactly at the slot start and leaves the booking and audit untouched", async () => {
      const bookingId = await confirmed();
      setNow(NOW + HOUR);
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "x" })).toEqual({ ok: false, reason: "slot_started" });
      expect(await app.listMyBookings("m1")).toMatchObject({ ok: true, data: [{ id: bookingId, status: "confirmed", cancellationReason: null }] });
      expect(await auditRows()).toHaveLength(0);
    });

    it("judges by the high-water mark, not the request clock", async () => {
      const bookingId = await confirmed();
      // 另一個請求已把高水位推過開始時間；本請求的 now 較早也不能取消
      await env.DB.prepare("INSERT INTO clock (id, hwm) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET hwm = max(hwm, ?1)").bind(NOW + HOUR + 5).run();
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toEqual({ ok: false, reason: "slot_started" });
      expect(await auditRows()).toHaveLength(0);
    });

    it("uses one clock for cancelled_at and the audit row when the high-water mark is ahead", async () => {
      const bookingId = await confirmed();
      const hwm = NOW + HOUR - 500;
      await env.DB.prepare("INSERT INTO clock (id, hwm) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET hwm = max(hwm, ?1)").bind(hwm).run();
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toMatchObject({ ok: true });
      const held = await env.DB.prepare("SELECT cancelled_at AS cancelledAt FROM holds WHERE id = ?").bind(bookingId).first<{ cancelledAt: number }>();
      expect(held!.cancelledAt).toBe(hwm);
      expect((await auditRows())[0]!.at).toBe(hwm);
    });

    it("stores the reason, shows it to the member, and records it in the audit detail", async () => {
      const bookingId = await confirmed();
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "  店休  " })).toMatchObject({ ok: true });
      expect(await app.listMyBookings("m1")).toMatchObject({ ok: true, data: [{ id: bookingId, cancellationReason: "店休" }] });
      const listed = await app.listSlotHoldsAndBookingsForAdmin(jwt, { slotId });
      expect(listed.ok && listed.data.holdsAndBookings[0]).toMatchObject({ cancellationReason: "店休" });
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.detail)).toEqual({ reason: "店休" });
    });

    it("stores null and audits reason null when omitted or whitespace-only", async () => {
      const first = await confirmed("m1");
      await app.cancelBookingForAdmin(jwt, { slotId, bookingId: first });
      const second = await confirmed("m2");
      await app.cancelBookingForAdmin(jwt, { slotId, bookingId: second, reason: "   " });
      expect(await app.listMyBookings("m1")).toMatchObject({ ok: true, data: [{ cancellationReason: null }] });
      expect(await app.listMyBookings("m2")).toMatchObject({ ok: true, data: [{ cancellationReason: null }] });
      expect((await auditRows()).map((row) => JSON.parse(row.detail))).toEqual([{ reason: null }, { reason: null }]);
    });

    it("limits the reason to 200 characters", async () => {
      const bookingId = await confirmed();
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "字".repeat(201) })).toMatchObject({
        ok: false,
        reason: "invalid_input",
        fields: { reason: ["取消原因不可超過 200 個字"] },
      });
      expect(await auditRows()).toHaveLength(0);
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "字".repeat(200) })).toMatchObject({ ok: true });
    });

    it("keeps repeated cancellation idempotent and keeps the first reason", async () => {
      const bookingId = await confirmed();
      await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "第一次" });
      setNow(NOW + HOUR + 1000);
      expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId, reason: "第二次" })).toMatchObject({ ok: true });
      expect(await app.listMyBookings("m1")).toMatchObject({ ok: true, data: [{ cancellationReason: "第一次" }] });
      expect(await auditRows()).toHaveLength(1);
    });
  });
});
