import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { setNow } from "./clock";
import { insertResource, insertSlot, resetDb } from "./db";
import { loginWith } from "./oauth-stub";
import { mintAccessJwt } from "./access";

const HOUR = 3_600_000;
const NOW = Date.UTC(2030, 0, 1);

const app = exports.default;

let resourceId: number;
let slotId: number;

beforeEach(async () => {
  await resetDb();
  setNow(NOW);
  resourceId = await insertResource({ name: "大廳", holdTtlSeconds: 600, seatsPerHold: 4 });
  slotId = await insertSlot(resourceId, NOW + HOUR, NOW + 2 * HOUR, 10);
});

/** 以 Google 登入，回傳 Better Auth 建立的會員編號與 session cookie。 */
async function signUp(sub: string) {
  const login = await loginWith("google", {
    sub,
    email: `${sub}@example.com`,
    email_verified: true,
    name: sub,
  });
  const { member } = await app.getMemberSession(login.sessionCookie!);
  return { memberId: member!.memberId, cookie: login.sessionCookie! };
}

async function remaining(id = slotId): Promise<number> {
  const result = await app.listSlots(resourceId);
  if (!result.ok) throw new Error(result.reason);
  return result.data.find((s) => s.id === id)!.remainingSeats;
}

async function book(memberId: string, seats: number, key: string, slot = slotId): Promise<number> {
  const created = await app.createHold(memberId, { slotId: slot, seats, idempotencyKey: key });
  if (!created.ok) throw new Error(`建立保留失敗：${created.reason}`);
  return created.data.id;
}

async function confirmed(memberId: string, seats: number, key: string, slot = slotId): Promise<number> {
  const id = await book(memberId, seats, key, slot);
  const result = await app.confirmHold(memberId, { holdId: id });
  if (!result.ok) throw new Error(`確認失敗：${result.reason}`);
  return id;
}

async function statusOf(holdId: number): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM holds WHERE id = ?").bind(holdId).first<{ status: string }>();
  return row!.status;
}

async function authRowCounts(userId: string) {
  const count = async (sql: string) =>
    (await env.DB.prepare(sql).bind(userId).first<{ n: number }>())!.n;
  return {
    user: await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?'),
    session: await count("SELECT COUNT(*) AS n FROM session WHERE user_id = ?"),
    account: await count("SELECT COUNT(*) AS n FROM account WHERE user_id = ?"),
  };
}

describe("deleteAccount", () => {
  it("未來的訂位變已取消，名額立即歸還", async () => {
    const alice = await signUp("g-alice");
    const id = await confirmed(alice.memberId, 3, "a");
    expect(await remaining()).toBe(7);

    const result = await app.deleteAccount(alice.memberId);

    expect(result).toEqual({ ok: true, data: { cancelledBookings: 1, releasedHolds: 0 } });
    expect(await statusOf(id)).toBe("cancelled");
    expect(await remaining()).toBe(10);
    expect(await app.listMyBookings(alice.memberId)).toEqual({ ok: true, data: [] });
  });

  it("被取消的訂位記下取消時間與取消者（會員），管理者看得到（#32）", async () => {
    const alice = await signUp("g-alice");
    const id = await confirmed(alice.memberId, 3, "a");
    setNow(NOW + 1000);

    await app.deleteAccount(alice.memberId);

    const listed = await app.listSlotHoldsAndBookingsForAdmin(await mintAccessJwt(), { slotId });
    if (!listed.ok) throw new Error(listed.reason);
    expect(listed.data.holdsAndBookings.find((h) => h.id === id)).toMatchObject({
      status: "cancelled",
      cancelledAt: NOW + 1000,
      cancelledBy: "member",
    });
  });

  it("有效保留變已釋放，名額立即歸還", async () => {
    const alice = await signUp("g-alice");
    const id = await book(alice.memberId, 2, "a");
    expect(await remaining()).toBe(8);

    const result = await app.deleteAccount(alice.memberId);

    expect(result).toEqual({ ok: true, data: { cancelledBookings: 0, releasedHolds: 1 } });
    expect(await statusOf(id)).toBe("released");
    expect(await remaining()).toBe(10);
    expect(await app.listMyHolds(alice.memberId)).toEqual({ ok: true, data: [] });
  });

  it("已過期但尚未被釋放的保留，刪除後也變已釋放", async () => {
    const alice = await signUp("g-alice");
    const id = await book(alice.memberId, 2, "a");
    setNow(NOW + HOUR / 2); // 保留期限 10 分鐘，已過期但釋放尚未執行
    expect(await statusOf(id)).toBe("held");

    const result = await app.deleteAccount(alice.memberId);

    expect(result).toEqual({ ok: true, data: { cancelledBookings: 0, releasedHolds: 1 } });
    expect(await statusOf(id)).toBe("released");
  });

  it("刪除後以舊會員編號確認其保留：失敗，名額不被占", async () => {
    const alice = await signUp("g-alice");
    const id = await book(alice.memberId, 2, "a");
    // 模擬與刪除交錯的結果：會員已不存在，但這筆保留仍是 held
    await env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(alice.memberId).run();
    await env.DB.prepare('DELETE FROM account WHERE user_id = ?').bind(alice.memberId).run();
    await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(alice.memberId).run();

    expect(await app.confirmHold(alice.memberId, { holdId: id })).toEqual({ ok: false, reason: "hold_not_found" });
    expect(await statusOf(id)).toBe("held");
    setNow(NOW + HOUR / 2); // 保留到期後名額歸還，證明它沒有變成永久占用的訂位
    expect(await remaining()).toBe(10);
  });

  it("已開始（過去）時段的訂位不受影響", async () => {
    const alice = await signUp("g-alice");
    const id = await confirmed(alice.memberId, 1, "a");
    setNow(NOW + 3 * HOUR);

    const result = await app.deleteAccount(alice.memberId);

    expect(result).toEqual({ ok: true, data: { cancelledBookings: 0, releasedHolds: 0 } });
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("先落地的寫入把有效時間推過時段開始時間後，帶開始前請求時間的刪除不取消該訂位（ADR 0011）", async () => {
    const alice = await signUp("g-alice");
    const bob = await signUp("g-bob");
    const id = await confirmed(alice.memberId, 1, "a");
    const laterSlot = await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10);
    setNow(NOW + HOUR);
    await book(bob.memberId, 1, "push", laterSlot);

    setNow(NOW + HOUR - 1);
    const result = await app.deleteAccount(alice.memberId);

    expect(result).toEqual({ ok: true, data: { cancelledBookings: 0, releasedHolds: 0 } });
    expect(await statusOf(id)).toBe("confirmed");
  });

  it("其他會員的訂位、保留與登入資料不受影響", async () => {
    const alice = await signUp("g-alice");
    const bob = await signUp("g-bob");
    await confirmed(alice.memberId, 1, "a");
    const bobBooking = await confirmed(bob.memberId, 2, "b", await insertSlot(resourceId, NOW + 3 * HOUR, NOW + 4 * HOUR, 10));
    const bobHold = await book(bob.memberId, 1, "c");

    await app.deleteAccount(alice.memberId);

    expect(await statusOf(bobBooking)).toBe("confirmed");
    expect(await statusOf(bobHold)).toBe("held");
    expect(await authRowCounts(bob.memberId)).toEqual({ user: 1, session: 1, account: 1 });
    expect((await app.getMemberSession(bob.cookie)).member?.memberId).toBe(bob.memberId);
  });

  it("移除 Better Auth 的 user、session、account；舊 cookie 不再是會員", async () => {
    const alice = await signUp("g-alice");
    expect(await authRowCounts(alice.memberId)).toEqual({ user: 1, session: 1, account: 1 });

    await app.deleteAccount(alice.memberId);

    expect(await authRowCounts(alice.memberId)).toEqual({ user: 0, session: 0, account: 0 });
    expect((await app.getMemberSession(alice.cookie)).member).toBeNull();
  });

  it("之後以同一登入方式登入，成為沒有舊資料的新會員", async () => {
    const alice = await signUp("g-alice");
    await confirmed(alice.memberId, 1, "a");
    await app.deleteAccount(alice.memberId);

    const again = await signUp("g-alice");

    expect(again.memberId).not.toBe(alice.memberId);
    expect(await app.listMyBookings(again.memberId)).toEqual({ ok: true, data: [] });
  });

  it("重複刪除：回成功且什麼都不變（冪等）", async () => {
    const alice = await signUp("g-alice");
    await confirmed(alice.memberId, 1, "a");
    await app.deleteAccount(alice.memberId);

    expect(await app.deleteAccount(alice.memberId)).toEqual({
      ok: true,
      data: { cancelledBookings: 0, releasedHolds: 0 },
    });
    expect(await remaining()).toBe(10);
  });

  it("memberId 空字串：invalid_input", async () => {
    expect(await app.deleteAccount("")).toMatchObject({ ok: false, reason: "invalid_input" });
  });
});
