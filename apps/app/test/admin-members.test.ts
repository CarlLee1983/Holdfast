import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { insertHold, insertResource, insertSlot, insertNamedUser, insertUser, resetDb } from "./db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1, 0);

const app = exports.default;

let jwt: string;
beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  jwt = await mintAccessJwt();
});

async function search(query: string) {
  const result = await app.searchMembersForAdmin(jwt, { query });
  if (!result.ok) throw new Error(`unexpected ${result.reason}`);
  return result.data;
}

async function member(memberId: string) {
  const result = await app.getMemberForAdmin(jwt, { memberId });
  if (!result.ok) throw new Error(`unexpected ${result.reason}`);
  return result.data;
}

describe("searchMembersForAdmin 比對規則", () => {
  it("名稱與 email 都是不分大小寫的部分比對，回傳 id、名稱、email", async () => {
    await insertNamedUser("u1", "Alice Chen", "alice@example.com");
    await insertNamedUser("u2", "王小明", "ming@Example.org");
    await insertNamedUser("u3", "Bob", "bob@other.net");

    expect(await search("ALICE")).toEqual([{ id: "u1", name: "Alice Chen", email: "alice@example.com" }]);
    expect(await search("ce c")).toHaveLength(1);
    expect(await search("小明")).toEqual([{ id: "u2", name: "王小明", email: "ming@Example.org" }]);
    expect((await search("EXAMPLE")).map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(await search("OTHER.NET")).toEqual([{ id: "u3", name: "Bob", email: "bob@other.net" }]);
  });

  it("查詢字串中的 % 與 _ 是字面字元，不是萬用字元", async () => {
    await insertNamedUser("u1", "a_b", "x1@example.com");
    await insertNamedUser("u2", "aXb", "x2@example.com");
    await insertNamedUser("u3", "100%", "x3@example.com");

    expect((await search("a_b")).map((m) => m.id)).toEqual(["u1"]);
    expect((await search("%")).map((m) => m.id)).toEqual(["u3"]);
  });

  it("前後空白會修剪；沒有符合的回傳空陣列", async () => {
    await insertNamedUser("u1", "Alice", "alice@example.com");

    expect((await search("  alice ")).map((m) => m.id)).toEqual(["u1"]);
    expect(await search("nobody")).toEqual([]);
  });

  it("依名稱排序（同名再依 id），最多 20 筆", async () => {
    for (let i = 0; i < 25; i++) {
      await insertNamedUser(`u${String(i).padStart(2, "0")}`, `member-${String(24 - i).padStart(2, "0")}`, `u${i}@example.com`);
    }
    await insertNamedUser("z1", "member-00", "z1@example.com");

    const found = await search("member");

    expect(found).toHaveLength(20);
    expect(found.map((m) => m.name)).toEqual([...found.map((m) => m.name)].sort());
    expect(found[0]).toMatchObject({ id: "u24", name: "member-00" });
    expect(found[1]).toMatchObject({ id: "z1", name: "member-00" });
  });

  it("空白查詢與過長查詢是 invalid_input", async () => {
    for (const query of ["", "   ", "x".repeat(201)]) {
      const result = await app.searchMembersForAdmin(jwt, { query });
      expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
    }
    expect(await app.searchMembersForAdmin(jwt, {})).toMatchObject({ ok: false, reason: "invalid_input" });
  });
});

describe("getMemberForAdmin", () => {
  it("帶出會員資料、有效保留與未來訂位，各附資源名稱與時段時間，依時段開始排序", async () => {
    await insertNamedUser("u1", "Alice", "alice@example.com");
    const hall = await insertResource({ name: "大廳" });
    const room = await insertResource({ name: "包廂" });
    const later = await insertSlot(hall, NOW + 10 * HOUR, NOW + 11 * HOUR, 10);
    const sooner = await insertSlot(room, NOW + 2 * HOUR, NOW + 3 * HOUR, 10);
    const heldSlot = await insertSlot(hall, NOW + 5 * HOUR, NOW + 6 * HOUR, 10);
    const bookingLater = await insertHold(later, 2, "confirmed", 0, "u1");
    const bookingSooner = await insertHold(sooner, 1, "confirmed", 0, "u1");
    const held = await insertHold(heldSlot, 3, "held", NOW + 600_000, "u1");

    const data = await member("u1");

    expect(data.member).toEqual({ id: "u1", name: "Alice", email: "alice@example.com" });
    expect(data.bookings).toEqual([
      { id: bookingSooner, slotId: sooner, resourceName: "包廂", startsAt: NOW + 2 * HOUR, endsAt: NOW + 3 * HOUR, seats: 1 },
      { id: bookingLater, slotId: later, resourceName: "大廳", startsAt: NOW + 10 * HOUR, endsAt: NOW + 11 * HOUR, seats: 2 },
    ]);
    expect(data.holds).toEqual([
      {
        id: held,
        slotId: heldSlot,
        resourceName: "大廳",
        startsAt: NOW + 5 * HOUR,
        endsAt: NOW + 6 * HOUR,
        seats: 3,
        expiresAt: NOW + 600_000,
      },
    ]);
  });

  it("過去與已開始的訂位不出現；剛好現在開始的也不算未來", async () => {
    await insertUser("u1");
    const r = await insertResource({ name: "大廳" });
    const past = await insertSlot(r, NOW - 3 * HOUR, NOW - 2 * HOUR, 10);
    const startingNow = await insertSlot(r, NOW, NOW + HOUR, 10);
    const future = await insertSlot(r, NOW + 1, NOW + HOUR, 10);
    await insertHold(past, 1, "confirmed", 0, "u1");
    await insertHold(startingNow, 1, "confirmed", 0, "u1");
    const kept = await insertHold(future, 1, "confirmed", 0, "u1");

    const data = await member("u1");

    expect(data.bookings.map((b) => b.id)).toEqual([kept]);
  });

  it("只有有效保留：已到期、已釋放、已取消的都不出現；別人的也不出現", async () => {
    await insertUser("u1");
    await insertUser("u2");
    const r = await insertResource({ name: "大廳" });
    const slot = await insertSlot(r, NOW + 5 * HOUR, NOW + 6 * HOUR, 20);
    const active = await insertHold(slot, 1, "held", NOW + 1000, "u1");
    await insertHold(slot, 1, "held", NOW, "u1");
    await insertHold(slot, 1, "held", NOW - 1000, "u1");
    await insertHold(slot, 1, "released", NOW + 1000, "u1");
    await insertHold(slot, 1, "cancelled", 0, "u1");
    await insertHold(slot, 1, "held", NOW + 1000, "u2");
    await insertHold(slot, 1, "confirmed", 0, "u2");

    const data = await member("u1");

    expect(data.holds.map((h) => h.id)).toEqual([active]);
    expect(data.bookings).toEqual([]);
  });

  it("沒有任何預訂的會員：兩個清單都是空的", async () => {
    await insertUser("u1");

    expect(await member("u1")).toMatchObject({ holds: [], bookings: [] });
  });

  it("會員不存在回 member_not_found", async () => {
    expect(await app.getMemberForAdmin(jwt, { memberId: "nope" })).toEqual({ ok: false, reason: "member_not_found" });
  });

  it("memberId 缺少或為空是 invalid_input", async () => {
    expect(await app.getMemberForAdmin(jwt, { memberId: "" })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(await app.getMemberForAdmin(jwt, {})).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("唯讀：不寫稽核", async () => {
    await insertUser("u1");
    await member("u1");
    await search("u1");
    const { results } = await env.DB.prepare("SELECT id FROM admin_audit").all();
    expect(results).toEqual([]);
  });
});
