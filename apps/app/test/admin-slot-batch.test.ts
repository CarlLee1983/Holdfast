import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, countRows, insertResource, insertSlot, resetDb } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1);

const app = exports.default;

let jwt: string;
let resourceId: number;
beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
  resourceId = await insertResource({ name: "大廳用餐" });
});

// 2030-01-01 是週二；台北 18:00 = UTC 10:00，台北 20:00 = UTC 12:00
const tuesdayToSaturday = {
  fromDate: "2030-01-01",
  toDate: "2030-01-07",
  weekdays: [2, 3, 4, 5, 6],
  startTimes: ["18:00", "20:00"],
  durationMinutes: 120,
  capacity: 20,
};
const input = () => ({ resourceId, ...tuesdayToSaturday });

/** 手算的已知 UTC 值：台北 2030-01-0d hh:00 = UTC 同日 (hh-8):00。 */
const slot = (day: number, taipeiHour: number, hours = 2) => ({
  startsAt: Date.UTC(2030, 0, day, taipeiHour - 8),
  endsAt: Date.UTC(2030, 0, day, taipeiHour - 8 + hours),
});

const expectedTimes = [
  slot(1, 18), slot(1, 20),
  slot(2, 18), slot(2, 20),
  slot(3, 18), slot(3, 20),
  slot(4, 18), slot(4, 20),
  slot(5, 18), slot(5, 20),
];

describe("previewSlotBatch", () => {
  it("週二到週六 18:00 與 20:00 各兩小時：回傳依開始時間升冪的 UTC 時段，不跳過任何一筆", async () => {
    const result = await app.previewSlotBatch(jwt, input());

    expect(result).toEqual({ ok: true, data: { slots: expectedTimes, skipped: [] } });
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("台北 00:30 開始的時段屬於當天的台北日期（UTC 是前一天 16:30）", async () => {
    const result = await app.previewSlotBatch(jwt, {
      ...input(),
      fromDate: "2030-01-02",
      toDate: "2030-01-02",
      weekdays: [3],
      startTimes: ["00:30"],
      durationMinutes: 60,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        slots: [{ startsAt: Date.UTC(2030, 0, 1, 16, 30), endsAt: Date.UTC(2030, 0, 1, 17, 30) }],
        skipped: [],
      },
    });
  });

  it("與既有時段相交的候選出現在 skipped；相鄰不算重疊；不同資源不算", async () => {
    const other = await insertResource({ name: "包廂" });
    await insertSlot(resourceId, slot(1, 17).startsAt, slot(1, 17, 1).endsAt, 5); // 17:00-18:00 與 18:00 首尾相接
    await insertSlot(resourceId, slot(2, 19).startsAt, slot(2, 19, 1).endsAt, 5); // 19:00-20:00 與 18:00-20:00 相交
    await insertSlot(other, slot(3, 18).startsAt, slot(3, 18).endsAt, 5); // 別的資源

    const result = await app.previewSlotBatch(jwt, input());

    expect(result).toEqual({
      ok: true,
      data: { slots: expectedTimes.filter((t) => t.startsAt !== slot(2, 18).startsAt), skipped: [slot(2, 18)] },
    });
  });

  it("停用的資源回傳 resource_retired，未知資源回傳 resource_not_found", async () => {
    const retired = await insertResource({ name: "停用" });
    await app.retireResource(jwt, retired);
    const auditBefore = await countRows("admin_audit");

    expect(await app.previewSlotBatch(jwt, { ...input(), resourceId: retired })).toEqual({ ok: false, reason: "resource_retired" });
    expect(await app.previewSlotBatch(jwt, { ...input(), resourceId: 999_999 })).toEqual({ ok: false, reason: "resource_not_found" });
    expect(await countRows("admin_audit")).toBe(auditBefore);
  });
});

describe("批次的大小與自我重疊", () => {
  const every = { weekdays: [0, 1, 2, 3, 4, 5, 6] };

  it.each([
    ["91 天", { ...every, fromDate: "2030-01-01", toDate: "2030-04-02", startTimes: ["10:00"] }, "invalid_input"],
    ["區間內沒有選到的星期（0 筆）", { fromDate: "2030-01-01", toDate: "2030-01-01", weekdays: [3], startTimes: ["10:00"] }, "slot_batch_empty"],
    ["201 筆", { ...every, fromDate: "2030-01-01", toDate: "2030-03-08", startTimes: ["08:00", "10:00", "12:00"] }, "slot_batch_too_large"],
    ["長度大於開始時間的間隔", { ...every, fromDate: "2030-01-01", toDate: "2030-01-02", startTimes: ["10:00", "11:00"], durationMinutes: 61 }, "slot_batch_overlaps_itself"],
  ])("%s：預覽與寫入都拒絕，不寫入也不寫稽核", async (_label, override, reason) => {
    const batch = { ...input(), durationMinutes: 30, ...override };

    for (const call of [(i: unknown) => app.previewSlotBatch(jwt, i), (i: unknown) => app.createSlotBatch(jwt, i)]) {
      const result = await call(batch);
      expect(result).toMatchObject({ ok: false, reason });
    }
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("90 天可以", async () => {
    const result = await app.previewSlotBatch(jwt, { ...input(), ...every, fromDate: "2030-01-01", toDate: "2030-03-31", startTimes: ["10:00"], durationMinutes: 30 });

    expect(result.ok && result.data.slots).toHaveLength(90);
  });

  it("剛好 200 筆可以", async () => {
    const result = await app.previewSlotBatch(jwt, {
      ...input(), ...every, fromDate: "2030-01-01", toDate: "2030-03-31", startTimes: ["08:00", "10:00"], durationMinutes: 30,
    });
    expect(result.ok && result.data.slots).toHaveLength(180);

    const exact = await app.previewSlotBatch(jwt, {
      ...input(), ...every, fromDate: "2030-01-01", toDate: "2030-01-25", startTimes: ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"], durationMinutes: 30,
    });
    expect(exact.ok && exact.data.slots).toHaveLength(200);
  });

  it("首尾相接不算自我重疊", async () => {
    const result = await app.previewSlotBatch(jwt, { ...input(), startTimes: ["10:00", "11:00"], durationMinutes: 60 });

    expect(result.ok).toBe(true);
  });
});

describe("批次輸入驗證", () => {
  it.each([
    ["日期格式錯", { fromDate: "2030/01/01" }, "fromDate"],
    ["不存在的日期", { toDate: "2030-02-30" }, "toDate"],
    ["toDate 早於 fromDate", { fromDate: "2030-01-05", toDate: "2030-01-04" }, "toDate"],
    ["fromDate 早於 2020-01-02", { fromDate: "2020-01-01", toDate: "2020-01-02" }, "fromDate"],
    ["toDate 晚於 2099-12-30", { fromDate: "2099-12-30", toDate: "2099-12-31" }, "toDate"],
    ["區間超過 90 天", { fromDate: "2030-01-01", toDate: "2030-04-02" }, "toDate"],
    ["weekdays 空", { weekdays: [] }, "weekdays"],
    ["weekdays 重複", { weekdays: [1, 1] }, "weekdays"],
    ["weekdays 超出 0–6", { weekdays: [7] }, "weekdays"],
    ["weekdays 非整數", { weekdays: [1.5] }, "weekdays"],
    ["startTimes 空", { startTimes: [] }, "startTimes"],
    ["startTimes 格式錯", { startTimes: ["9:00"] }, "startTimes"],
    ["startTimes 是 24:00", { startTimes: ["24:00"] }, "startTimes"],
    ["startTimes 分鐘超過 59", { startTimes: ["10:60"] }, "startTimes"],
    ["startTimes 重複", { startTimes: ["10:00", "10:00"] }, "startTimes"],
    ["startTimes 超過 48 個", { startTimes: Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`) }, "startTimes"],
    ["durationMinutes 為 0", { durationMinutes: 0 }, "durationMinutes"],
    ["durationMinutes 為 1441", { durationMinutes: 1441 }, "durationMinutes"],
    ["capacity 為 0", { capacity: 0 }, "capacity"],
  ])("輸入無效（%s）回傳 invalid_input 與欄位錯誤，預覽與寫入都不寫入", async (_label, override, field) => {
    for (const call of [(i: unknown) => app.previewSlotBatch(jwt, i), (i: unknown) => app.createSlotBatch(jwt, i)]) {
      const result = await call({ ...input(), ...override });

      expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
      expect(!result.ok && result.reason === "invalid_input" && result.fields[field]?.length).toBeGreaterThan(0);
    }
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("區間超過 90 天的訊息", async () => {
    const result = await app.previewSlotBatch(jwt, { ...input(), fromDate: "2030-01-01", toDate: "2030-04-02" });

    expect(result).toMatchObject({ ok: false, reason: "invalid_input", fields: { toDate: ["日期區間不可超過 90 天"] } });
  });
});

describe("批次的日期界線落在單筆時段的界線內", () => {
  const day = { weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: 5 };

  it("2020-01-02 台北 00:00 可以（UTC 2020-01-01 16:00，不早於單筆下限）", async () => {
    const result = await app.createSlotBatch(jwt, {
      resourceId, ...day, fromDate: "2020-01-02", toDate: "2020-01-02", startTimes: ["00:00"], durationMinutes: 60,
    });

    expect(result.ok && result.data.slots.map((s) => s.startsAt)).toEqual([Date.UTC(2020, 0, 1, 16)]);
  });

  it("2099-12-30 台北 23:59 加 1440 分鐘可以（結束 UTC 2099-12-31 15:59，早於單筆上限）", async () => {
    const result = await app.createSlotBatch(jwt, {
      resourceId, ...day, fromDate: "2099-12-30", toDate: "2099-12-30", startTimes: ["23:59"], durationMinutes: 1440,
    });

    expect(result.ok && result.data.slots.map((s) => s.endsAt)).toEqual([Date.UTC(2099, 11, 31, 15, 59)]);
  });
});

describe("createSlotBatch", () => {
  it("寫入預覽的每一個時段，回傳含 id 與容量的紀錄，依開始時間升冪", async () => {
    const result = await app.createSlotBatch(jwt, input());

    expect(result).toEqual({
      ok: true,
      data: {
        slots: expectedTimes.map((t) => ({ id: expect.any(Number), resourceId, ...t, capacity: 20 })),
        skipped: [],
      },
    });
    expect(await countRows("slots")).toBe(10);
  });

  it("同一輸入下，預覽與寫入的 slots、skipped 時間一致", async () => {
    await insertSlot(resourceId, slot(2, 19).startsAt, slot(2, 19, 1).endsAt, 5);

    const preview = await app.previewSlotBatch(jwt, input());
    const created = await app.createSlotBatch(jwt, input());

    expect(preview.ok && created.ok).toBe(true);
    if (!preview.ok || !created.ok) return;
    expect(created.data.slots.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual(preview.data.slots);
    expect(created.data.skipped).toEqual(preview.data.skipped);
    expect(created.data.skipped).toHaveLength(1);
  });

  it("預覽之後才插入的衝突時段：寫入時被跳過、出現在 skipped，其他照寫", async () => {
    const preview = await app.previewSlotBatch(jwt, input());
    expect(preview.ok && preview.data.skipped).toEqual([]);
    await insertSlot(resourceId, slot(3, 19).startsAt, slot(3, 19, 1).endsAt, 5);

    const created = await app.createSlotBatch(jwt, input());

    expect(created.ok && created.data.skipped).toEqual([slot(3, 18)]);
    expect(created.ok && created.data.slots).toHaveLength(9);
    expect(await countRows("slots")).toBe(10);
  });

  it("停用的資源回傳 resource_retired，未知資源回傳 resource_not_found，皆不寫入", async () => {
    const retired = await insertResource({ name: "停用" });
    await app.retireResource(jwt, retired);
    const auditBefore = await countRows("admin_audit");

    expect(await app.createSlotBatch(jwt, { ...input(), resourceId: retired })).toEqual({ ok: false, reason: "resource_retired" });
    expect(await app.createSlotBatch(jwt, { ...input(), resourceId: 999_999 })).toEqual({ ok: false, reason: "resource_not_found" });
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(auditBefore);
  });

  it("恰好寫一列稽核：action、target 與 detail 的 input、slotIds", async () => {
    const created = await app.createSlotBatch(jwt, input());
    const ids = created.ok ? created.data.slots.map((s) => s.id) : [];

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "slot.create_batch",
      target_type: "resource",
      target_id: resourceId,
      at: NOW,
    });
    expect(JSON.parse(rows[0]!.detail)).toEqual({ input: input(), slotIds: ids });
    expect(ids).toHaveLength(10);
  });

  it("稽核的 slotIds 只含實際寫入的時段（有跳過時）", async () => {
    await insertSlot(resourceId, slot(1, 19).startsAt, slot(1, 19, 1).endsAt, 5);

    const created = await app.createSlotBatch(jwt, input());

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const [row] = await auditRows();
    expect(JSON.parse(row!.detail).slotIds).toEqual(created.data.slots.map((s) => s.id));
    expect(created.data.slots).toHaveLength(9);
  });

  it("全部被跳過：回 ok、slots 為空、沒有稽核列", async () => {
    await app.createSlotBatch(jwt, input());
    const before = await countRows("slots");
    const auditBefore = await countRows("admin_audit");

    const again = await app.createSlotBatch(jwt, input());

    expect(again).toEqual({ ok: true, data: { slots: [], skipped: expectedTimes } });
    expect(await countRows("slots")).toBe(before);
    expect(await countRows("admin_audit")).toBe(auditBefore);
  });

  it("結構化 log 的 detail 與 D1 稽核列的 detail 一致", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await app.createSlotBatch(jwt, input())).ok).toBe(true);

      const logged = log.mock.calls
        .map(([line]) => JSON.parse(String(line)))
        .filter((entry) => entry.event === "admin_audit");
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ action: "slot.create_batch", targetType: "resource", targetId: resourceId });
      const [row] = await auditRows();
      expect(logged[0].detail).toEqual(JSON.parse(row!.detail));
    } finally {
      log.mockRestore();
    }
  });

  it("批次產生的是普通時段：會員面 listSlots 看得到，單筆 createSlot 仍會檢查重疊", async () => {
    await app.createSlotBatch(jwt, { ...input(), fromDate: "2030-01-02", toDate: "2030-01-02", weekdays: [3], startTimes: ["18:00"] });

    const listed = await app.listSlots(resourceId);
    expect(listed.ok && listed.data.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))).toEqual([slot(2, 18)]);
    expect(await app.createSlot(jwt, { resourceId, ...slot(2, 19), capacity: 5 })).toEqual({ ok: false, reason: "slot_overlaps" });
  });
});
