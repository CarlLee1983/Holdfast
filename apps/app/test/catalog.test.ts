import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { setNow } from "./clock";
import { insertResource, insertSlot, resetDb } from "./db";

const HOUR = 3_600_000;
// 2030-01-01T00:00:00Z
const NOW = Date.UTC(2030, 0, 1);

// 經 Service Binding RPC 的同一條路徑呼叫 App Worker
const app = exports.default;

describe("listResources", () => {
  beforeEach(resetDb);

  it("沒有資源時回傳空陣列", async () => {
    expect(await app.listResources()).toEqual({ ok: true, data: [] });
  });

  it("回傳資源的名稱、保留期限、單筆名額上限與取消截止時間", async () => {
    const id = await insertResource({
      name: "包廂",
      holdTtlSeconds: 300,
      seatsPerHold: 6,
      cancellationCutoffSeconds: 7200,
    });

    expect(await app.listResources()).toEqual({
      ok: true,
      data: [
        {
          id,
          name: "包廂",
          holdTtlSeconds: 300,
          seatsPerHold: 6,
          cancellationCutoffSeconds: 7200,
        },
      ],
    });
  });

  it("保留期限預設為 10 分鐘", async () => {
    await insertResource({ name: "大廳" });

    const result = await app.listResources();

    expect(result.ok && result.data[0]?.holdTtlSeconds).toBe(600);
  });
});

describe("listSlots", () => {
  beforeEach(async () => {
    await resetDb();
    setNow(NOW);
  });

  it("回傳時段的開始、結束、容量與剩餘名額，依開始時間排序", async () => {
    const resourceId = await insertResource({ name: "大廳" });
    const later = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 8);
    const earlier = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 20);

    expect(await app.listSlots(resourceId)).toEqual({
      ok: true,
      data: [
        { id: earlier, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, capacity: 20, remainingSeats: 20 },
        { id: later, startsAt: NOW + 3 * HOUR, endsAt: NOW + 4 * HOUR, capacity: 8, remainingSeats: 8 },
      ],
    });
  });

  it("只回傳該資源的時段", async () => {
    const hall = await insertResource({ name: "大廳" });
    const room = await insertResource({ name: "包廂" });
    await insertSlot(hall, NOW + HOUR, NOW + 2 * HOUR, 20);
    const roomSlot = await insertSlot(room, NOW + HOUR, NOW + 2 * HOUR, 6);

    const result = await app.listSlots(room);

    expect(result.ok && result.data.map((s) => s.id)).toEqual([roomSlot]);
  });

  it("資源存在但沒有時段時回傳空陣列", async () => {
    const resourceId = await insertResource({ name: "大廳" });

    expect(await app.listSlots(resourceId)).toEqual({ ok: true, data: [] });
  });

  it("未知的資源回傳 resource_not_found", async () => {
    expect(await app.listSlots(999)).toEqual({ ok: false, reason: "resource_not_found" });
  });

  it("以注入的現在時間排除已結束的時段；進行中的仍列出，結束時刻恰等於現在視為已結束", async () => {
    const resourceId = await insertResource({ name: "大廳" });
    await insertSlot(resourceId, NOW - 2 * HOUR, NOW - HOUR, 10); // 已結束
    await insertSlot(resourceId, NOW - HOUR, NOW, 10); // 恰在此刻結束
    const ongoing = await insertSlot(resourceId, NOW - HOUR, NOW + HOUR, 10); // 進行中
    const upcoming = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);

    const before = await app.listSlots(resourceId);
    expect(before.ok && before.data.map((s) => s.id)).toEqual([ongoing, upcoming]);

    setNow(NOW + 90 * 60_000); // 快轉到進行中時段已結束
    const after = await app.listSlots(resourceId);
    expect(after.ok && after.data.map((s) => s.id)).toEqual([upcoming]);
  });
});
