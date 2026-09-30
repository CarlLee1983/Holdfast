import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, countRows, insertHold, insertResource, insertSlot, insertUser, resetDb } from "./db";

const app = exports.default;
const NOW = Date.UTC(2030, 0, 1);
const HOUR = 3_600_000;
let jwt: string;
let resourceId: number;
let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
  resourceId = await insertResource({ name: "包廂" });
  slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
});

const newSlot = (id: number, start = NOW + 3 * HOUR) => ({
  resourceId: id, startsAt: start, endsAt: start + HOUR, capacity: 10,
});
const newHold = (member: string, slot: number, key: string) =>
  app.createHold(member, { slotId: slot, seats: 1, idempotencyKey: key });

async function retiredAt(id = resourceId) {
  const row = await env.DB.prepare("SELECT retired_at FROM resources WHERE id = ?").bind(id).first<{ retired_at: number | null }>();
  return row?.retired_at;
}

describe("resource retirement RPC", () => {
  it("counts future confirmed booking rows, persists the timestamp, and audits each state change once", async () => {
    await insertHold(slotId, 3, "confirmed", 0);
    await insertHold(slotId, 2, "confirmed", 0);
    await insertHold(slotId, 1, "cancelled", 0);
    await insertHold(slotId, 1, "held", NOW + HOUR);
    const started = await insertSlot(resourceId, NOW, NOW + HOUR, 10);
    await insertHold(started, 1, "confirmed", 0);
    const other = await insertResource({ name: "大廳" });
    const otherSlot = await insertSlot(other, NOW + HOUR, NOW + 2 * HOUR, 10);
    await insertHold(otherSlot, 1, "confirmed", 0);

    expect(await app.getResourceForAdmin(jwt, resourceId)).toMatchObject({
      ok: true, data: { id: resourceId, retiredAt: null, futureBookingCount: 2 },
    });
    const first = await app.retireResource(jwt, resourceId);
    expect(first).toEqual({ ok: true, data: { id: resourceId, retiredAt: NOW, futureBookingCount: 2 } });
    expect(await retiredAt()).toBe(NOW);
    setNow(NOW + 1_000);
    expect(await app.retireResource(jwt, resourceId)).toEqual(first);
    expect(await retiredAt()).toBe(NOW);
    expect(await app.getResourceForAdmin(jwt, resourceId)).toMatchObject({
      ok: true, data: { retiredAt: NOW, futureBookingCount: 2 },
    });

    const listing = await app.listResourcesForAdmin(jwt);
    expect(listing.ok && listing.data.find((row) => row.id === resourceId)).toMatchObject({ retiredAt: NOW });
    expect(listing.ok && listing.data.find((row) => row.id === other)).toMatchObject({ retiredAt: null });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: ADMIN_EMAIL, action: "resource.retire", target_type: "resource", target_id: resourceId, at: NOW });

    expect(await app.reactivateResource(jwt, resourceId)).toEqual({ ok: true, data: { id: resourceId, retiredAt: null } });
    expect(await retiredAt()).toBeNull();
    expect(await app.reactivateResource(jwt, resourceId)).toEqual({ ok: true, data: { id: resourceId, retiredAt: null } });
    expect((await auditRows()).map((row) => row.action)).toEqual(["resource.retire", "resource.reactivate"]);
    expect((await auditRows())[1]).toMatchObject({ actor_email: ADMIN_EMAIL, target_type: "resource", target_id: resourceId, at: NOW + 1_000 });
  });

  it.each(["retireResource", "reactivateResource"] as const)("%s validates JWT, identifier, and existence without an audit", async (method) => {
    expect(await app[method]("bad", resourceId)).toEqual({ ok: false, reason: "unauthorized" });
    for (const id of [0, -1, 1.5, "1", Number.NaN]) {
      expect(await app[method](jwt, id as number)).toMatchObject({ ok: false, reason: "invalid_input" });
    }
    expect(await app[method](jwt, 999_999)).toEqual({ ok: false, reason: "resource_not_found" });
    expect(await countRows("admin_audit")).toBe(0);
    expect(await retiredAt()).toBeNull();
  });
});

describe("retired resource behavior", () => {
  it("hides member catalog and slots, blocks new holds and slots, and keeps existing holds and bookings", async () => {
    await insertUser("member");
    const booking = await newHold("member", slotId, "booking");
    expect(booking.ok).toBe(true);
    if (!booking.ok) return;
    expect((await app.confirmHold("member", { holdId: booking.data.id })).ok).toBe(true);
    const pending = await newHold("member", await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10), "pending");
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const siblingId = await insertResource({ name: "大廳" });
    const siblingSlot = await insertSlot(siblingId, NOW + HOUR, NOW + 2 * HOUR, 10);

    expect((await app.retireResource(jwt, resourceId)).ok).toBe(true);
    const catalog = await app.listResources();
    expect(catalog.ok && catalog.data.map((row) => row.id)).toEqual([siblingId]);
    expect(catalog.ok && catalog.data[0]).not.toHaveProperty("retiredAt");
    expect(await app.listSlots(resourceId)).toEqual({ ok: true, data: [] });
    expect(await newHold("other", slotId, "new")).toEqual({ ok: false, reason: "resource_retired" });
    expect(await app.createSlot(jwt, newSlot(resourceId))).toEqual({ ok: false, reason: "resource_retired" });
    expect(await newHold("member", pending.data.slotId, "pending")).toEqual(pending);
    expect((await app.confirmHold("member", { holdId: pending.data.id })).ok).toBe(true);
    expect(await app.listMyBookings("member")).toMatchObject({ ok: true, data: [{ id: booking.data.id }, { id: pending.data.id }] });
    expect((await newHold("other", siblingSlot, "sibling")).ok).toBe(true);
    expect((await app.createSlot(jwt, newSlot(siblingId))).ok).toBe(true);
    expect(await countRows("holds")).toBe(3);

    expect(await app.reactivateResource(jwt, resourceId)).toMatchObject({ ok: true, data: { retiredAt: null } });
    const visible = await app.listResources();
    expect(visible.ok && visible.data.map((row) => row.id)).toEqual([resourceId, siblingId]);
    expect(visible.ok && visible.data[0]).not.toHaveProperty("retiredAt");
    const slots = await app.listSlots(resourceId);
    expect(slots.ok && slots.data.map((slot) => slot.id)).toContain(slotId);
    expect((await newHold("other", slotId, "after-reactivation")).ok).toBe(true);
    expect((await app.createSlot(jwt, newSlot(resourceId, NOW + 5 * HOUR))).ok).toBe(true);
  });

  it("keeps retired slots in the admin agenda with their retired timestamp and booking", async () => {
    const booking = await insertHold(slotId, 2, "confirmed", 0);
    await app.retireResource(jwt, resourceId);
    const result = await app.listAgendaForAdmin(jwt, { from: NOW, to: NOW + 24 * HOUR });
    expect(result.ok && result.data).toMatchObject([
      { id: slotId, resourceId, resourceRetiredAt: NOW, bookings: [{ id: booking }] },
    ]);
  });

  it("serializes concurrent retirement with a new hold so no hold can be created after retirement wins", async () => {
    const results = await Promise.all([
      app.retireResource(jwt, resourceId),
      newHold("new-member", slotId, "racing"),
    ] as const);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok || results[1].reason === "resource_retired").toBe(true);
    expect(await newHold("later-member", slotId, "later")).toEqual({ ok: false, reason: "resource_retired" });
  });
});
