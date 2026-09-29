import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, countRows, insertResource, insertSlot, resetDb } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1);

const app = exports.default;

let jwt: string;
beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
});

const validResource = { name: "大廳用餐", seatsPerHold: 4, cancellationCutoffSeconds: 7200 };

describe("createResource", () => {
  it("建立資源，保留期限省略時預設 600 秒，並回傳完整資源", async () => {
    const result = await app.createResource(jwt, validResource);

    expect(result).toEqual({
      ok: true,
      data: { id: expect.any(Number), ...validResource, holdTtlSeconds: 600 },
    });
    expect(await app.listResources()).toEqual({
      ok: true,
      data: [result.ok ? result.data : null],
    });
  });

  it("可指定保留期限；名稱前後空白會去掉", async () => {
    const result = await app.createResource(jwt, { ...validResource, name: "  包廂  ", holdTtlSeconds: 300 });

    expect(result.ok && result.data).toMatchObject({ name: "包廂", holdTtlSeconds: 300 });
  });

  it("同一個 batch 寫入一列稽核紀錄，含操作者 email、時間與內容", async () => {
    const result = await app.createResource(jwt, validResource);
    const id = result.ok ? result.data.id : -1;

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "resource.create",
      target_type: "resource",
      target_id: id,
      at: NOW,
    });
    expect(JSON.parse(rows[0]!.detail)).toEqual({ ...validResource, holdTtlSeconds: 600 });
  });

  it.each([
    ["名稱空白", { ...validResource, name: "   " }, "name"],
    ["缺少名稱", { seatsPerHold: 4, cancellationCutoffSeconds: 0 }, "name"],
    ["保留期限為 0", { ...validResource, holdTtlSeconds: 0 }, "holdTtlSeconds"],
    ["保留期限為負", { ...validResource, holdTtlSeconds: -5 }, "holdTtlSeconds"],
    ["保留期限非整數", { ...validResource, holdTtlSeconds: 1.5 }, "holdTtlSeconds"],
    ["單筆名額上限為 0", { ...validResource, seatsPerHold: 0 }, "seatsPerHold"],
    ["取消截止時間為負", { ...validResource, cancellationCutoffSeconds: -1 }, "cancellationCutoffSeconds"],
    ["欄位型別錯誤", { ...validResource, seatsPerHold: "4" }, "seatsPerHold"],
    ["NaN", { ...validResource, seatsPerHold: NaN }, "seatsPerHold"],
  ])("輸入無效（%s）回傳 invalid_input 與欄位錯誤，且不寫入", async (_label, input, field) => {
    const result = await app.createResource(jwt, input);

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(!result.ok && result.reason === "invalid_input" && result.fields[field]?.length).toBeGreaterThan(0);
    expect(await countRows("resources")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("輸入不是物件時回傳 invalid_input", async () => {
    expect(await app.createResource(jwt, null)).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("取消截止時間可以是 0", async () => {
    const result = await app.createResource(jwt, { ...validResource, cancellationCutoffSeconds: 0 });
    expect(result.ok).toBe(true);
  });
});

describe("updateResource", () => {
  const changed = { name: "貴賓包廂", holdTtlSeconds: 900, seatsPerHold: 8, cancellationCutoffSeconds: 86400 };

  it("更新資源全部欄位，只影響該資源，並寫入稽核紀錄", async () => {
    const id = await insertResource({ name: "大廳" });
    const other = await insertResource({ name: "另一個", holdTtlSeconds: 111 });

    const result = await app.updateResource(jwt, { id, ...changed });

    expect(result).toEqual({ ok: true, data: { id, ...changed } });
    const list = await app.listResourcesForAdmin(jwt);
    expect(list.ok && list.data.find((r) => r.id === other)).toMatchObject({ name: "另一個", holdTtlSeconds: 111 });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "resource.update",
      target_type: "resource",
      target_id: id,
      at: NOW,
    });
    expect(JSON.parse(rows[0]!.detail)).toEqual(changed);
  });

  it("未知的資源回傳 resource_not_found，且不寫稽核紀錄", async () => {
    expect(await app.updateResource(jwt, { id: 999, ...changed })).toEqual({
      ok: false,
      reason: "resource_not_found",
    });
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("輸入無效回傳 invalid_input，資源不變", async () => {
    const id = await insertResource({ name: "大廳" });

    const result = await app.updateResource(jwt, { id, ...changed, name: "" });

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    const list = await app.listResourcesForAdmin(jwt);
    expect(list.ok && list.data[0]?.name).toBe("大廳");
  });

  it("修改保留期限不動任何其他資料（資源上不存衍生的到期時間）", async () => {
    const id = await insertResource({ name: "大廳", holdTtlSeconds: 600 });
    const slotId = await insertSlot(id, NOW + HOUR, NOW + 2 * HOUR, 10);

    await app.updateResource(jwt, { id, ...changed, name: "大廳", holdTtlSeconds: 60 });

    const slots = await app.listSlots(id);
    expect(slots.ok && slots.data.map((s) => s.id)).toEqual([slotId]);
  });
});

describe("listResourcesForAdmin", () => {
  it("回傳所有資源", async () => {
    const id = await insertResource({ name: "大廳" });

    const result = await app.listResourcesForAdmin(jwt);

    expect(result).toEqual({
      ok: true,
      data: [{ id, name: "大廳", holdTtlSeconds: 600, seatsPerHold: 4, cancellationCutoffSeconds: 3600 }],
    });
  });
});

describe("createSlot", () => {
  let resourceId: number;
  beforeEach(async () => {
    resourceId = await insertResource({ name: "大廳" });
  });

  const slot = (startsAt: number, endsAt: number, capacity = 10, id = resourceId) => ({
    resourceId: id,
    startsAt,
    endsAt,
    capacity,
  });

  it("建立時段，回傳完整時段並寫入稽核紀錄", async () => {
    const result = await app.createSlot(jwt, slot(NOW + HOUR, NOW + 2 * HOUR, 12));

    expect(result).toEqual({
      ok: true,
      data: { id: expect.any(Number), resourceId, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, capacity: 12 },
    });
    const id = result.ok ? result.data.id : -1;
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "slot.create",
      target_type: "slot",
      target_id: id,
      at: NOW,
    });
    expect(JSON.parse(rows[0]!.detail)).toEqual(slot(NOW + HOUR, NOW + 2 * HOUR, 12));
    const listed = await app.listSlots(resourceId);
    expect(listed.ok && listed.data.map((s) => s.id)).toEqual([id]);
  });

  it.each([
    // it.each 在 beforeEach 之前求值，此處不能用尚未賦值的 resourceId
    ["開始等於結束", slot(NOW + HOUR, NOW + HOUR, 10, 1), "endsAt"],
    ["開始晚於結束", slot(NOW + 2 * HOUR, NOW + HOUR, 10, 1), "endsAt"],
    ["容量為 0", slot(NOW + HOUR, NOW + 2 * HOUR, 0, 1), "capacity"],
    ["容量非整數", slot(NOW + HOUR, NOW + 2 * HOUR, 2.5, 1), "capacity"],
    ["缺少開始時間", { resourceId: 1, endsAt: NOW, capacity: 1 }, "startsAt"],
    ["時間不是數字", { ...slot(NOW, NOW + HOUR, 10, 1), startsAt: "2030-01-01" }, "startsAt"],
  ])("輸入無效（%s）回傳 invalid_input，且不寫入", async (_label, input, field) => {
    const result = await app.createSlot(jwt, input);

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(!result.ok && result.reason === "invalid_input" && result.fields[field]?.length).toBeGreaterThan(0);
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("未知的資源回傳 resource_not_found，且不寫入", async () => {
    expect(await app.createSlot(jwt, slot(NOW, NOW + HOUR, 5, 999))).toEqual({
      ok: false,
      reason: "resource_not_found",
    });
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  describe("同一資源的時段重疊（[start, end) 相交）", () => {
    beforeEach(async () => {
      await insertSlot(resourceId, NOW + 2 * HOUR, NOW + 4 * HOUR, 10);
    });

    it.each([
      ["完全相同", NOW + 2 * HOUR, NOW + 4 * HOUR],
      ["與前段重疊", NOW + HOUR, NOW + 3 * HOUR],
      ["與後段重疊", NOW + 3 * HOUR, NOW + 5 * HOUR],
      ["包住既有時段", NOW + HOUR, NOW + 5 * HOUR],
      ["被既有時段包住", NOW + 2.5 * HOUR, NOW + 3.5 * HOUR],
    ])("%s：回傳 slot_overlaps，不寫入時段與稽核", async (_label, start, end) => {
      expect(await app.createSlot(jwt, slot(start, end))).toEqual({ ok: false, reason: "slot_overlaps" });
      expect(await countRows("slots")).toBe(1);
      expect(await countRows("admin_audit")).toBe(0);
    });

    it.each([
      ["緊接在既有時段之前", NOW, NOW + 2 * HOUR],
      ["緊接在既有時段之後", NOW + 4 * HOUR, NOW + 6 * HOUR],
    ])("%s：相鄰不算重疊", async (_label, start, end) => {
      expect((await app.createSlot(jwt, slot(start, end))).ok).toBe(true);
      expect(await countRows("slots")).toBe(2);
      expect(await countRows("admin_audit")).toBe(1);
    });

    it("不同資源的同一時間不算重疊", async () => {
      const room = await insertResource({ name: "包廂" });

      expect((await app.createSlot(jwt, slot(NOW + 2 * HOUR, NOW + 4 * HOUR, 6, room))).ok).toBe(true);
    });
  });

  it("併發建立互相重疊的時段：只有一個成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => app.createSlot(jwt, slot(NOW + i * 1000, NOW + HOUR + i * 1000))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "slot_overlaps")).toHaveLength(4);
    expect(await countRows("slots")).toBe(1);
    expect(await countRows("admin_audit")).toBe(1);
  });
});
