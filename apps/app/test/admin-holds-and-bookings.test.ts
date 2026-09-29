import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, insertResource, insertSlot, resetDb } from "./db";

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
    const first = await hold("m1", "first");
    expect((await app.confirmHold("m1", { holdId: first })).ok).toBe(true);
    setNow(NOW + HOUR + 1000);
    const before = await app.listSlots(resourceId);
    expect(before.ok && before.data[0]?.remainingSeats).toBe(0);
    const cancelled = await app.cancelBookingForAdmin(jwt, { slotId, bookingId: first });
    expect(cancelled).toEqual({ ok: true, data: { id: first, slotId, seats: 2 } });
    const after = await app.listSlots(resourceId);
    expect(after.ok && after.data[0]?.remainingSeats).toBe(2);
    const bookings = await app.listMyBookings("m1");
    expect(bookings.ok && bookings.data).toMatchObject([{ id: first, status: "cancelled", cancelledAt: NOW + HOUR + 1000, cancelledBy: "admin" }]);
    expect(await app.confirmHold("m1", { holdId: first })).toEqual({ ok: false, reason: "hold_expired" });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: ADMIN_EMAIL, action: "booking.cancel", target_type: "booking", target_id: first });
  });

  it("writes exactly one audit for concurrent and repeated cancellations", async () => {
    const bookingId = await hold("m1", "first");
    await app.confirmHold("m1", { holdId: bookingId });
    const results = await Promise.all(Array.from({ length: 4 }, () => app.cancelBookingForAdmin(jwt, { slotId, bookingId })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await app.cancelBookingForAdmin(jwt, { slotId, bookingId })).toMatchObject({ ok: true });
    expect(await auditRows()).toHaveLength(1);
  });

  it("does not cancel a booking from another slot", async () => {
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
});
