import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { insertHold, insertResource, insertSlot, insertUser, resetDb, setSlotCapacity } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1, 0);
// 一個查詢區間：[DAY, DAY + 24h)
const DAY = Date.UTC(2030, 0, 2, 0);

const app = exports.default;

let jwt: string;
beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
});

async function agenda(input: unknown) {
  const result = await app.listAgendaForAdmin(jwt, input);
  if (!result.ok) throw new Error(`unexpected ${result.reason}`);
  return result.data;
}

async function cancelHold(holdId: number, by: "admin" | "member", at: number) {
  await env.DB.prepare("UPDATE holds SET status = 'cancelled', cancelled_by = ?, cancelled_at = ? WHERE id = ?")
    .bind(by, at, holdId)
    .run();
}

describe("listAgendaForAdmin 區間", () => {
  it("[from, to) 半開：剛好在 from 開始的納入，剛好在 to 開始的排除", async () => {
    const r = await insertResource({ name: "大廳" });
    const atFrom = await insertSlot(r, DAY, DAY + HOUR, 4);
    const inside = await insertSlot(r, DAY + 23 * HOUR, DAY + 24 * HOUR, 4);
    await insertSlot(r, DAY + 24 * HOUR, DAY + 25 * HOUR, 4);
    await insertSlot(r, DAY - HOUR, DAY, 4);

    const slots = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slots.map((s) => s.id)).toEqual([atFrom, inside]);
  });

  it("跨資源依 starts_at、id 排序，並帶資源名稱", async () => {
    const hall = await insertResource({ name: "大廳" });
    const room = await insertResource({ name: "包廂" });
    const late = await insertSlot(hall, DAY + 5 * HOUR, DAY + 6 * HOUR, 4);
    const earlyRoom = await insertSlot(room, DAY + 2 * HOUR, DAY + 3 * HOUR, 6);
    const sameTimeHall = await insertSlot(hall, DAY + 2 * HOUR - 1000, DAY + 2 * HOUR, 4);
    const sameStartRoom = await insertSlot(room, DAY + 5 * HOUR, DAY + 6 * HOUR, 2);

    const slots = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slots.map((s) => s.id)).toEqual([sameTimeHall, earlyRoom, late, sameStartRoom]);
    expect(slots.map((s) => s.resourceName)).toEqual(["大廳", "包廂", "大廳", "包廂"]);
    expect(slots[1]).toMatchObject({ resourceId: room, startsAt: DAY + 2 * HOUR, endsAt: DAY + 3 * HOUR, capacity: 6 });
  });

  it("resourceId 只留該資源的時段", async () => {
    const hall = await insertResource({ name: "大廳" });
    const room = await insertResource({ name: "包廂" });
    await insertSlot(hall, DAY + HOUR, DAY + 2 * HOUR, 4);
    const roomSlot = await insertSlot(room, DAY + HOUR, DAY + 2 * HOUR, 4);

    const slots = await agenda({ from: DAY, to: DAY + 24 * HOUR, resourceId: room });

    expect(slots.map((s) => s.id)).toEqual([roomSlot]);
  });

  it("沒有時段回傳空陣列", async () => {
    expect(await agenda({ from: DAY, to: DAY + 24 * HOUR })).toEqual([]);
  });
});

describe("listAgendaForAdmin 名單與占用", () => {
  it("訂位、有效保留、已取消三類分開；已到期與已釋放的保留不出現", async () => {
    const r = await insertResource({ name: "大廳" });
    const slotId = await insertSlot(r, DAY + HOUR, DAY + 2 * HOUR, 10);
    await insertUser("alice");
    await insertUser("bob");
    await insertUser("carol");
    const booking = await insertHold(slotId, 2, "confirmed", 0, "alice");
    const active = await insertHold(slotId, 3, "held", NOW + 60_000, "bob");
    await insertHold(slotId, 1, "held", NOW - 1, "carol"); // 已到期但尚未釋放
    await insertHold(slotId, 1, "released", NOW - HOUR, "carol");
    const memberCancelled = await insertHold(slotId, 1, "confirmed", 0, "carol");
    await cancelHold(memberCancelled, "member", NOW - 1000);
    const adminCancelled = await insertHold(slotId, 4, "confirmed", 0, "alice");
    await cancelHold(adminCancelled, "admin", NOW - 500);

    const [slot] = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slot!.bookings).toEqual([{ id: booking, memberName: "alice", seats: 2 }]);
    expect(slot!.holds).toEqual([{ id: active, memberName: "bob", seats: 3, expiresAt: NOW + 60_000 }]);
    expect(slot!.cancelledBookings).toEqual([
      { id: memberCancelled, memberName: "carol", seats: 1, cancelledBy: "member", cancelledAt: NOW - 1000 },
      { id: adminCancelled, memberName: "alice", seats: 4, cancelledBy: "admin", cancelledAt: NOW - 500 },
    ]);
    expect(slot).toMatchObject({ capacity: 10, occupied: 5, remainingSeats: 5, overcommitted: false });
  });

  it("早於取消者欄位的已取消訂位（cancelled_by／cancelled_at 為 null）照常列出，不讓整個日程表失敗", async () => {
    const r = await insertResource({ name: "大廳" });
    const slotId = await insertSlot(r, DAY + HOUR, DAY + 2 * HOUR, 10);
    const legacy = await insertHold(slotId, 2, "cancelled", 0, "dave");

    const [slot] = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slot!.cancelledBookings).toEqual([
      { id: legacy, memberName: null, seats: 2, cancelledBy: null, cancelledAt: null },
    ]);
  });

  it("每份名單依建立時間、id 排序，會員帳號已不存在時 memberName 是 null", async () => {
    const r = await insertResource({ name: "大廳" });
    const slotId = await insertSlot(r, DAY + HOUR, DAY + 2 * HOUR, 10);
    const first = await insertHold(slotId, 1, "confirmed", 0, "gone");
    const second = await insertHold(slotId, 1, "confirmed", 0, "gone");

    const [slot] = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slot!.bookings.map((b) => b.id)).toEqual([first, second]);
    expect(slot!.bookings[0]!.memberName).toBeNull();
  });

  it("容量降到低於占用時 overcommitted，剩餘為 0", async () => {
    const r = await insertResource({ name: "大廳" });
    const slotId = await insertSlot(r, DAY + HOUR, DAY + 2 * HOUR, 5);
    await insertHold(slotId, 4, "confirmed", 0);
    await setSlotCapacity(slotId, 3);

    const [slot] = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slot).toMatchObject({ capacity: 3, occupied: 4, remainingSeats: 0, overcommitted: true });
  });

  it("沒有任何保留的時段三份名單都是空的", async () => {
    const r = await insertResource({ name: "大廳" });
    await insertSlot(r, DAY + HOUR, DAY + 2 * HOUR, 5);

    const [slot] = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slot).toMatchObject({ occupied: 0, remainingSeats: 5, bookings: [], holds: [], cancelledBookings: [] });
  });
});

describe("listAgendaForAdmin 大量時段", () => {
  it("一天 150 個時段（跨資源）仍能查出，最後一個時段的訂位在名單裡", async () => {
    const resourceIds = [await insertResource({ name: "大廳" }), await insertResource({ name: "包廂" })];
    const MINUTE = 60_000;
    let lastSlot = 0;
    for (let i = 0; i < 150; i++) {
      lastSlot = await insertSlot(resourceIds[i % 2]!, DAY + i * 9 * MINUTE, DAY + (i + 1) * 9 * MINUTE, 4);
    }
    const booking = await insertHold(lastSlot, 2, "confirmed", 0);

    const slots = await agenda({ from: DAY, to: DAY + 24 * HOUR });

    expect(slots).toHaveLength(150);
    expect(slots.at(-1)!.bookings.map((b) => b.id)).toEqual([booking]);
  });
});

describe("listAgendaForAdmin 輸入與授權", () => {
  it.each([
    ["to 等於 from", { from: DAY, to: DAY }],
    ["to 早於 from", { from: DAY, to: DAY - 1 }],
    ["區間超過 48 小時", { from: DAY, to: DAY + 48 * HOUR + 1 }],
    ["from 不是整數", { from: 1.5, to: DAY }],
    ["缺少 to", { from: DAY }],
    ["resourceId 不是正整數", { from: DAY, to: DAY + HOUR, resourceId: 0 }],
  ])("%s → invalid_input", async (_label, input) => {
    expect(await app.listAgendaForAdmin(jwt, input)).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("剛好 48 小時的區間可以查", async () => {
    expect((await app.listAgendaForAdmin(jwt, { from: DAY, to: DAY + 48 * HOUR })).ok).toBe(true);
  });

  it("沒有有效 JWT 回 unauthorized", async () => {
    expect(await app.listAgendaForAdmin("", { from: DAY, to: DAY + HOUR })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
