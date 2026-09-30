import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_EMAIL, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { auditRows, countRows, insertHold, insertResource, insertSlot, resetDb } from "./db";

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
      data: { id: expect.any(Number), ...validResource, holdTtlSeconds: 600, description: null },
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
    expect(JSON.parse(rows[0]!.detail)).toEqual({ ...validResource, holdTtlSeconds: 600, description: null });
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
    ["說明超過 200 字", { ...validResource, description: "a".repeat(201) }, "description"],
    ["說明不是文字", { ...validResource, description: 5 }, "description"],
    ["名稱超過 200 字", { ...validResource, name: "a".repeat(201) }, "name"],
    ["保留期限超過 24 小時", { ...validResource, holdTtlSeconds: 86_401 }, "holdTtlSeconds"],
    ["單筆名額上限超過 1000", { ...validResource, seatsPerHold: 1001 }, "seatsPerHold"],
    ["取消截止時間超過 30 天", { ...validResource, cancellationCutoffSeconds: 30 * 86_400 + 1 }, "cancellationCutoffSeconds"],
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

  it("建立時可帶說明，前後空白會去掉，並經 listResources 回傳", async () => {
    const result = await app.createResource(jwt, { ...validResource, description: "  面向開放廚房的長桌  " });

    expect(result.ok && result.data.description).toBe("面向開放廚房的長桌");
    const list = await app.listResources();
    expect(list.ok && list.data[0]?.description).toBe("面向開放廚房的長桌");
    const rows = await auditRows();
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ description: "面向開放廚房的長桌" });
  });

  it("說明省略、空字串或只有空白時為 null", async () => {
    for (const description of [undefined, "", "   "]) {
      const result = await app.createResource(jwt, { ...validResource, description });
      expect(result.ok && result.data.description).toBeNull();
    }
  });

  it("上限本身合法（名稱 200 字、說明 200 字、24 小時、1000 名額、30 天）", async () => {
    const result = await app.createResource(jwt, {
      name: "a".repeat(200),
      description: "說".repeat(200),
      holdTtlSeconds: 86_400,
      seatsPerHold: 1000,
      cancellationCutoffSeconds: 30 * 86_400,
    });
    expect(result.ok).toBe(true);
  });
});

describe("updateResource", () => {
  const changed = { name: "貴賓包廂", holdTtlSeconds: 900, seatsPerHold: 8, cancellationCutoffSeconds: 86400, description: "" };

  it("更新資源全部欄位，只影響該資源，並寫入稽核紀錄", async () => {
    const id = await insertResource({ name: "大廳" });
    const other = await insertResource({ name: "另一個", holdTtlSeconds: 111 });

    const result = await app.updateResource(jwt, { id, ...changed });

    expect(result).toEqual({ ok: true, data: { id, ...changed, description: null } });
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
    // before 與 after 一起記錄；before 由 batch 內先於 UPDATE 的那句 INSERT … SELECT 讀出
    expect(JSON.parse(rows[0]!.detail)).toEqual({
      before: { name: "大廳", holdTtlSeconds: 600, seatsPerHold: 4, cancellationCutoffSeconds: 3600, description: null },
      after: { ...changed, description: null },
    });
  });

  it("修改說明，並可清空回 null；超過 200 字被拒且說明不變", async () => {
    const id = await insertResource({ name: "大廳", description: "舊說明" });

    const updated = await app.updateResource(jwt, { id, ...changed, description: "新說明" });
    expect(updated.ok && updated.data.description).toBe("新說明");

    const tooLong = await app.updateResource(jwt, { id, ...changed, description: "a".repeat(201) });
    expect(tooLong).toMatchObject({ ok: false, reason: "invalid_input" });
    const still = await app.listResourcesForAdmin(jwt);
    expect(still.ok && still.data[0]?.description).toBe("新說明");

    const cleared = await app.updateResource(jwt, { id, ...changed, description: "" });
    expect(cleared.ok && cleared.data.description).toBeNull();
    const rows = await auditRows();
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ before: { description: "舊說明" }, after: { description: "新說明" } });
  });

  it("修改時省略說明被拒，既有說明不會悄悄被清掉", async () => {
    const id = await insertResource({ name: "大廳", description: "舊說明" });
    const { description: _omitted, ...withoutDescription } = changed;

    const result = await app.updateResource(jwt, { id, ...withoutDescription });

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    const list = await app.listResourcesForAdmin(jwt);
    expect(list.ok && list.data[0]?.description).toBe("舊說明");
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
      data: [{ id, name: "大廳", holdTtlSeconds: 600, seatsPerHold: 4, cancellationCutoffSeconds: 3600, description: null }],
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
    ["容量超過 100000", slot(NOW + HOUR, NOW + 2 * HOUR, 100_001, 1), "capacity"],
    ["開始早於 2020-01-01", slot(Date.UTC(2019, 11, 31), NOW, 10, 1), "startsAt"],
    ["結束晚於 2100-01-01", slot(NOW, Date.UTC(2100, 0, 1) + 1, 10, 1), "endsAt"],
    ["時間是毫秒誤當秒（過小）", slot(1_893_495_600, 1_893_502_800, 10, 1), "startsAt"],
  ])("輸入無效（%s）回傳 invalid_input，且不寫入", async (_label, input, field) => {
    const result = await app.createSlot(jwt, input);

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(!result.ok && result.reason === "invalid_input" && result.fields[field]?.length).toBeGreaterThan(0);
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("時間範圍與容量的上限本身合法（2020-01-01 至 2100-01-01、容量 100000）", async () => {
    const result = await app.createSlot(
      jwt,
      slot(Date.UTC(2020, 0, 1), Date.UTC(2100, 0, 1), 100_000),
    );
    expect(result.ok).toBe(true);
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

describe("updateSlotCapacity", () => {
  let resourceId: number;
  let slotId: number;
  beforeEach(async () => {
    resourceId = await insertResource({ name: "大廳" });
    slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
  });

  it("調高容量，回傳更新後的時段，並寫入含前後容量的稽核紀錄", async () => {
    const result = await app.updateSlotCapacity(jwt, { slotId, capacity: 20 });

    expect(result).toEqual({
      ok: true,
      data: { id: slotId, resourceId, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, capacity: 20 },
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      action: "slot.update_capacity",
      target_type: "slot",
      target_id: slotId,
      at: NOW,
    });
    expect(JSON.parse(rows[0]!.detail)).toEqual({ before: { capacity: 10 }, after: { capacity: 20 } });
  });

  it("調低到低於已占用：允許，既有保留與訂位不受影響，新保留以 slot_overcommitted 被拒絕", async () => {
    await insertHold(slotId, 4, "held", NOW + 600_000);
    await insertHold(slotId, 4, "confirmed", NOW - 1);

    const result = await app.updateSlotCapacity(jwt, { slotId, capacity: 3 });

    expect(result.ok).toBe(true);
    expect(await countRows("holds")).toBe(2);
    expect(await app.createHold("m-new", { slotId, seats: 1, idempotencyKey: "k" })).toEqual({
      ok: false,
      reason: "slot_overcommitted",
    });
  });

  it("未知的時段回傳 slot_not_found，且不寫稽核", async () => {
    expect(await app.updateSlotCapacity(jwt, { slotId: 999_999, capacity: 5 })).toEqual({
      ok: false,
      reason: "slot_not_found",
    });
    expect(await countRows("admin_audit")).toBe(0);
  });

  it.each([
    ["容量為 0", { capacity: 0 }],
    ["容量為負", { capacity: -1 }],
    ["容量非整數", { capacity: 2.5 }],
    ["容量超過 100000", { capacity: 100_001 }],
    ["容量是字串", { capacity: "5" }],
    ["容量是 NaN", { capacity: NaN }],
  ])("輸入無效（%s）回傳 invalid_input，容量不變且不寫稽核", async (_label, input) => {
    const result = await app.updateSlotCapacity(jwt, { slotId, ...input });

    expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(!result.ok && result.reason === "invalid_input" && result.fields.capacity?.length).toBeGreaterThan(0);
    expect(await countRows("admin_audit")).toBe(0);
    const listed = await app.listSlotsForAdmin(jwt, resourceId);
    expect(listed.ok && listed.data[0]!.capacity).toBe(10);
  });

  it("時段編號無效回傳 invalid_input", async () => {
    const result = await app.updateSlotCapacity(jwt, { slotId: 0, capacity: 5 });
    expect(!result.ok && result.reason === "invalid_input" && result.fields.slotId?.length).toBeGreaterThan(0);
  });
});

describe("deleteSlot", () => {
  let resourceId: number;
  let slotId: number;
  beforeEach(async () => {
    resourceId = await insertResource({ name: "大廳" });
    slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
  });

  it("刪除沒有任何保留的時段，並寫入稽核紀錄（含刪除前的內容）", async () => {
    expect(await app.deleteSlot(jwt, { slotId })).toEqual({ ok: true, data: { id: slotId } });

    expect(await countRows("slots")).toBe(0);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "slot.delete", target_type: "slot", target_id: slotId, at: NOW });
    expect(JSON.parse(rows[0]!.detail)).toEqual({
      resourceId,
      startsAt: NOW + HOUR,
      endsAt: NOW + 2 * HOUR,
      capacity: 10,
    });
  });

  it.each([
    ["有效保留", "held", NOW + 1000],
    ["訂位", "confirmed", NOW - 1],
  ] as const)("仍有%s：回傳 slot_in_use，時段、保留與稽核都不變", async (_label, status, expiresAt) => {
    await insertHold(slotId, 2, status, expiresAt);

    expect(await app.deleteSlot(jwt, { slotId })).toEqual({ ok: false, reason: "slot_in_use" });
    expect(await countRows("slots")).toBe(1);
    expect(await countRows("holds")).toBe(1);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("只剩已過期或已釋放的保留（含剛好到期）：可刪除，這些無效紀錄一併移除", async () => {
    await insertHold(slotId, 2, "held", NOW);
    await insertHold(slotId, 2, "released", NOW - HOUR);

    expect((await app.deleteSlot(jwt, { slotId })).ok).toBe(true);
    expect(await countRows("slots")).toBe(0);
    expect(await countRows("holds")).toBe(0);
  });

  it("先落地的寫入把有效時間推過保留的到期時間後，帶到期前請求時間的刪除視該保留為可丟棄（ADR 0011）", async () => {
    const held = await app.createHold("m1", { slotId, seats: 1, idempotencyKey: "k" });
    if (!held.ok) throw new Error(`建立保留失敗：${held.reason}`);
    const laterSlot = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10);
    const expiresAt = NOW + 600_000;
    setNow(expiresAt);
    expect((await app.createHold("m2", { slotId: laterSlot, seats: 1, idempotencyKey: "push" })).ok).toBe(true);

    setNow(expiresAt - 1);

    expect(await app.deleteSlot(jwt, { slotId })).toEqual({ ok: true, data: { id: slotId } });
    expect(await countRows("slots")).toBe(1);
  });

  it("有訂位、其他狀態（例如日後的已取消）的紀錄：回傳 slot_in_use，不會被連帶刪除（ADR 0012）", async () => {
    await insertHold(slotId, 2, "released", NOW - HOUR);
    await insertHold(slotId, 2, "cancelled", NOW - HOUR);

    expect(await app.deleteSlot(jwt, { slotId })).toEqual({ ok: false, reason: "slot_in_use" });
    expect(await countRows("slots")).toBe(1);
    expect(await countRows("holds")).toBe(2);
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("不影響其他時段的保留", async () => {
    const other = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10);
    await insertHold(other, 1, "released", NOW - HOUR);

    expect((await app.deleteSlot(jwt, { slotId })).ok).toBe(true);
    expect(await countRows("holds")).toBe(1);
  });

  it("未知的時段回傳 slot_not_found，且不寫稽核", async () => {
    expect(await app.deleteSlot(jwt, { slotId: 999_999 })).toEqual({ ok: false, reason: "slot_not_found" });
    expect(await countRows("admin_audit")).toBe(0);
  });

  it("時段編號無效回傳 invalid_input", async () => {
    expect(await app.deleteSlot(jwt, { slotId: "1" })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await countRows("slots")).toBe(1);
  });

  it("刪除與建立保留併發：保留成功則刪除被拒絕，反之亦然，不會留下指向已刪時段的保留", async () => {
    const [del, hold] = await Promise.all([
      app.deleteSlot(jwt, { slotId }),
      app.createHold("m1", { slotId, seats: 1, idempotencyKey: "k" }),
    ]);

    expect(del.ok).toBe(!hold.ok);
    expect(await countRows("slots")).toBe(del.ok ? 0 : 1);
    expect(await countRows("holds")).toBe(hold.ok ? 1 : 0);
  });
});

describe("listSlotsForAdmin", () => {
  let resourceId: number;
  beforeEach(async () => {
    resourceId = await insertResource({ name: "大廳" });
  });

  it("每個時段顯示容量、已占用、剩餘與超占狀態，依開始時間排序", async () => {
    const later = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10);
    const early = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
    await insertHold(early, 3, "held", NOW + 1000);
    await insertHold(early, 2, "confirmed", NOW - 1);
    await insertHold(early, 9, "held", NOW); // 剛好到期：不占用
    await insertHold(early, 9, "released", NOW - HOUR);

    const result = await app.listSlotsForAdmin(jwt, resourceId);

    expect(result).toEqual({
      ok: true,
      data: [
        { id: early, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, capacity: 10, occupied: 5, remainingSeats: 5, overcommitted: false },
        { id: later, startsAt: NOW + 3 * HOUR, endsAt: NOW + 4 * HOUR, capacity: 10, occupied: 0, remainingSeats: 10, overcommitted: false },
      ],
    });
  });

  it("占用剛好等於容量不算超占；超過才算，剩餘以 0 顯示", async () => {
    const full = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 4);
    const over = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 4);
    await insertHold(full, 4, "confirmed", 0);
    await insertHold(over, 5, "confirmed", 0);

    const result = await app.listSlotsForAdmin(jwt, resourceId);
    const byId = new Map(result.ok ? result.data.map((s) => [s.id, s]) : []);

    expect(byId.get(full)).toMatchObject({ occupied: 4, remainingSeats: 0, overcommitted: false });
    expect(byId.get(over)).toMatchObject({ occupied: 5, remainingSeats: 0, overcommitted: true });
  });

  it("包含已結束的時段（管理者需要能清理）", async () => {
    const past = await insertSlot(resourceId, NOW - 2 * HOUR, NOW - HOUR, 5);

    const result = await app.listSlotsForAdmin(jwt, resourceId);
    expect(result.ok && result.data.map((s) => s.id)).toEqual([past]);
  });

  it("未知的資源回傳 resource_not_found", async () => {
    expect(await app.listSlotsForAdmin(jwt, 999_999)).toEqual({ ok: false, reason: "resource_not_found" });
  });
});
