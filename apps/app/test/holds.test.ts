import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { countRows, insertResource, insertSlot, resetDb, setSlotCapacity } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1);
const TTL_SECONDS = 600;

const app = exports.default;

let resourceId: number;
let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  resourceId = await insertResource({ name: "大廳", holdTtlSeconds: TTL_SECONDS, seatsPerHold: 4 });
  slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
});

const hold = (seats: number, key: string, slot = slotId) => ({ slotId: slot, seats, idempotencyKey: key });

async function remaining(id = slotId): Promise<number> {
  const result = await app.listSlots(resourceId);
  if (!result.ok) throw new Error(result.reason);
  return result.data.find((s) => s.id === id)!.remainingSeats;
}

async function activeHolds(member: string) {
  const result = await app.listMyHolds(member);
  if (!result.ok) throw new Error(result.reason);
  return result.data;
}

const okSeats = (results: Awaited<ReturnType<typeof app.createHold>>[]) =>
  results.reduce((sum, r) => sum + (r.ok ? r.data.seats : 0), 0);

describe("createHold 成功", () => {
  it("回傳保留，到期時間 = 現在 + 資源的保留期限，剩餘名額扣掉", async () => {
    const result = await app.createHold("m1", hold(3, "k1"));

    expect(result).toEqual({
      ok: true,
      data: { id: expect.any(Number), slotId, seats: 3, expiresAt: NOW + TTL_SECONDS * 1000 },
    });
    expect(await remaining()).toBe(7);
  });

  it("單筆名額剛好等於上限可以", async () => {
    expect((await app.createHold("m1", hold(4, "k1"))).ok).toBe(true);
  });

  it("剛好把容量占滿可以，之後再要就名額不足", async () => {
    expect((await app.createHold("m1", hold(4, "a"))).ok).toBe(true);
    expect((await app.createHold("m2", hold(4, "b"))).ok).toBe(true);
    expect((await app.createHold("m3", hold(2, "c"))).ok).toBe(true);
    expect(await remaining()).toBe(0);

    expect(await app.createHold("m4", hold(1, "d"))).toEqual({ ok: false, reason: "insufficient_seats" });
  });

  it("修改保留期限只影響之後的保留，既有保留的到期時間不變", async () => {
    const first = await app.createHold("m1", hold(1, "a"));
    const adminJwt = await mintAccessJwt();
    const updated = await app.updateResource(adminJwt, {
      id: resourceId,
      name: "大廳",
      holdTtlSeconds: 60,
      seatsPerHold: 4,
      cancellationCutoffSeconds: 3600,
    });
    expect(updated.ok).toBe(true);

    const second = await app.createHold("m2", hold(1, "b"));

    expect(first.ok && first.data.expiresAt).toBe(NOW + 600_000);
    expect(second.ok && second.data.expiresAt).toBe(NOW + 60_000);
    expect((await activeHolds("m1"))[0]?.expiresAt).toBe(NOW + 600_000);
  });
});

describe("createHold 具名失敗原因", () => {
  it("超過單筆名額上限", async () => {
    expect(await app.createHold("m1", hold(5, "k"))).toEqual({ ok: false, reason: "seats_per_hold_exceeded" });
    expect(await countRows("holds")).toBe(0);
  });

  it("時段已開始（starts_at == now 也算）", async () => {
    const started = await insertSlot(resourceId, NOW, NOW + HOUR, 10);

    expect(await app.createHold("m1", hold(1, "k", started))).toEqual({ ok: false, reason: "slot_started" });
  });

  it("starts_at 剛好晚 1 毫秒可以", async () => {
    const almost = await insertSlot(resourceId, NOW + 2 * HOUR, NOW + 3 * HOUR, 10);
    setNow(NOW + 2 * HOUR - 1);

    expect((await app.createHold("m1", hold(1, "k", almost))).ok).toBe(true);
  });

  it("找不到時段", async () => {
    expect(await app.createHold("m1", hold(1, "k", 999_999))).toEqual({ ok: false, reason: "slot_not_found" });
  });

  it("時段超占：既有保留已超過（被調低的）容量", async () => {
    await app.createHold("m1", hold(4, "a"));
    await app.createHold("m2", hold(4, "b"));
    await setSlotCapacity(slotId, 5);

    expect(await app.createHold("m3", hold(1, "c"))).toEqual({ ok: false, reason: "slot_overcommitted" });
    expect(await remaining()).toBe(0);
  });

  it("名額不足", async () => {
    await app.createHold("m1", hold(4, "a"));
    await app.createHold("m2", hold(4, "b"));

    expect(await app.createHold("m3", hold(3, "c"))).toEqual({ ok: false, reason: "insufficient_seats" });
  });
});

describe("已過期但尚未釋放的保留", () => {
  it("不計入剩餘名額，也不擋新的保留", async () => {
    await app.createHold("m1", hold(4, "a"));
    await app.createHold("m2", hold(4, "b"));
    await app.createHold("m3", hold(2, "c"));
    expect(await remaining()).toBe(0);

    setNow(NOW + TTL_SECONDS * 1000); // expires_at == now 已算過期
    expect(await remaining()).toBe(10);

    expect((await app.createHold("m4", hold(4, "d"))).ok).toBe(true);
    expect(await countRows("holds")).toBe(4); // 過期的仍在表裡，沒有被刪
  });
});

describe("冪等鍵", () => {
  it("重送同一請求：回傳同一筆保留，只有一列，名額只扣一次", async () => {
    const first = await app.createHold("m1", hold(2, "k"));
    const replay = await app.createHold("m1", hold(2, "k"));

    expect(replay).toEqual(first);
    expect(await countRows("holds")).toBe(1);
    expect(await remaining()).toBe(8);
  });

  it("重送時保留已過期，仍回傳原本那一筆（不新建）", async () => {
    const first = await app.createHold("m1", hold(2, "k"));
    setNow(NOW + HOUR / 2);

    expect(await app.createHold("m1", hold(2, "k"))).toEqual(first);
    expect(await countRows("holds")).toBe(1);
  });

  it("重送時名額已被別人占滿，仍回傳原本那一筆", async () => {
    const first = await app.createHold("m1", hold(2, "k"));
    await app.createHold("m2", hold(4, "a"));
    await app.createHold("m3", hold(4, "b"));

    expect(await app.createHold("m1", hold(2, "k"))).toEqual(first);
  });

  it("同一個鍵搭配不同名額或時段：idempotency_key_conflict", async () => {
    await app.createHold("m1", hold(2, "k"));
    const otherSlot = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10);

    expect(await app.createHold("m1", hold(3, "k"))).toEqual({ ok: false, reason: "idempotency_key_conflict" });
    expect(await app.createHold("m1", hold(2, "k", otherSlot))).toEqual({
      ok: false,
      reason: "idempotency_key_conflict",
    });
    expect(await countRows("holds")).toBe(1);
  });

  it("不同會員用同一個鍵：各自一筆保留", async () => {
    const a = await app.createHold("m1", hold(1, "same"));
    const b = await app.createHold("m2", hold(1, "same"));

    expect(a.ok && b.ok && a.data.id !== b.data.id).toBe(true);
    expect(await countRows("holds")).toBe(2);
  });

  it("鍵前後的空白會被修剪", async () => {
    const a = await app.createHold("m1", hold(1, " k "));
    const b = await app.createHold("m1", hold(1, "k"));

    expect(b).toEqual(a);
  });
});

describe("createHold 輸入驗證", () => {
  it.each([
    ["slotId 不是正整數", { slotId: 0, seats: 1, idempotencyKey: "k" }, "slotId"],
    ["slotId 是 NaN", { slotId: Number.NaN, seats: 1, idempotencyKey: "k" }, "slotId"],
    ["seats 為 0", { slotId: 1, seats: 0, idempotencyKey: "k" }, "seats"],
    ["seats 超過 1000", { slotId: 1, seats: 1001, idempotencyKey: "k" }, "seats"],
    ["seats 不是整數", { slotId: 1, seats: 1.5, idempotencyKey: "k" }, "seats"],
    ["冪等鍵空白", { slotId: 1, seats: 1, idempotencyKey: "   " }, "idempotencyKey"],
    ["冪等鍵超過 100 字", { slotId: 1, seats: 1, idempotencyKey: "x".repeat(101) }, "idempotencyKey"],
    ["缺少冪等鍵", { slotId: 1, seats: 1 }, "idempotencyKey"],
  ])("%s：invalid_input", async (_label, input, field) => {
    const result = await app.createHold("m1", input);

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(!result.ok && "fields" in result && result.fields[field]).toBeTruthy();
  });

  it("輸入不是物件：invalid_input", async () => {
    expect(await app.createHold("m1", "oops")).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it.each([["", "空字串"], [undefined as unknown as string, "undefined"], [42 as unknown as string, "數字"]])(
    "memberId 是 %s（%s）：invalid_input",
    async (memberId) => {
      expect(await app.createHold(memberId, hold(1, "k"))).toMatchObject({
        ok: false,
        reason: "invalid_input",
      });
      expect(await countRows("holds")).toBe(0);
    },
  );
});

describe("listMyHolds", () => {
  it("只列出自己的有效保留，依到期時間、id 排序，帶資源名稱與時段時間", async () => {
    const a = await app.createHold("m1", hold(1, "a"));
    setNow(NOW + 1000);
    const b = await app.createHold("m1", hold(2, "b"));
    await app.createHold("m2", hold(1, "c"));

    expect(await app.listMyHolds("m1")).toEqual({
      ok: true,
      data: [
        {
          id: a.ok ? a.data.id : 0,
          slotId,
          resourceName: "大廳",
          startsAt: NOW + HOUR,
          endsAt: NOW + 2 * HOUR,
          seats: 1,
          expiresAt: NOW + 600_000,
        },
        {
          id: b.ok ? b.data.id : 0,
          slotId,
          resourceName: "大廳",
          startsAt: NOW + HOUR,
          endsAt: NOW + 2 * HOUR,
          seats: 2,
          expiresAt: NOW + 1000 + 600_000,
        },
      ],
    });
  });

  it("不列出已過期的保留", async () => {
    await app.createHold("m1", hold(1, "a"));
    setNow(NOW + TTL_SECONDS * 1000);

    expect(await app.listMyHolds("m1")).toEqual({ ok: true, data: [] });
  });

  it("memberId 空字串：invalid_input", async () => {
    expect(await app.listMyHolds("")).toMatchObject({ ok: false, reason: "invalid_input" });
  });
});

describe("併發不超賣（ADR 0004）", () => {
  it("容量 5：10 位會員各要 1 個名額，恰好 5 個成功", async () => {
    const slot = await insertSlot(resourceId, NOW + 5 * HOUR, NOW + 6 * HOUR, 5);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => app.createHold(`member-${i}`, hold(1, `k-${i}`, slot))),
    );

    const succeeded = results.filter((r) => r.ok);
    expect(succeeded).toHaveLength(5);
    expect(results.filter((r) => !r.ok && r.reason === "insufficient_seats")).toHaveLength(5);
    expect(okSeats(results)).toBeLessThanOrEqual(5);
    expect(await remaining(slot)).toBe(0);
  });

  it("容量 5：10 位會員各要 2 個名額，恰好 2 個成功", async () => {
    const slot = await insertSlot(resourceId, NOW + 5 * HOUR, NOW + 6 * HOUR, 5);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => app.createHold(`member-${i}`, hold(2, `k-${i}`, slot))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(okSeats(results)).toBeLessThanOrEqual(5);
    expect(await remaining(slot)).toBe(1);
  });

  it("同一會員同一冪等鍵併發重送：只有一列", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => app.createHold("m1", hold(2, "same"))));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.ok && r.data.id)).size).toBe(1);
    expect(await countRows("holds")).toBe(1);
  });
});
