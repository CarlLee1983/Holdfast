import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./db";
import { loginWith, ORIGIN } from "./oauth-stub";

const app = exports.default;

async function userEmails(): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT email FROM "user" ORDER BY email').all<{
    email: string;
  }>();
  return results.map((row) => row.email);
}

/** getMemberSession 回傳 { member, setCookies }；多數測試只關心 member。 */
async function memberOf(cookie: string) {
  return (await app.getMemberSession(cookie)).member;
}

async function sessionCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM session").first<{ n: number }>();
  return row!.n;
}

describe("會員登入（LINE 與 Google）", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("Google 登入成功，建立會員並取得 session", async () => {
    const login = await loginWith("google", {
      sub: "g-1",
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    });

    expect(login.status).toBe(302);
    expect(login.location).toBe("/");
    expect(login.sessionCookie).toBeDefined();
    expect(await userEmails()).toEqual(["alice@example.com"]);
    expect(await memberOf(login.sessionCookie!)).toMatchObject({ name: "Alice" });
  });

  it("LINE 沒有提供 email 時登入不被拒絕，會員 email 是 placeholder", async () => {
    const login = await loginWith("line", { sub: "U2", name: "Bob" });

    expect(login.status).toBe(302);
    expect(login.location).toBe("/");
    expect(login.sessionCookie).toBeDefined();
    expect(await userEmails()).toEqual(["line-u2@members.holdfast.invalid"]);
  });

  it("LINE 有提供 email 時仍不儲存，一律用 placeholder", async () => {
    const login = await loginWith("line", { sub: "U3", email: "carol@example.com", name: "Carol" });

    expect(login.sessionCookie).toBeDefined();
    expect(await userEmails()).toEqual(["line-u3@members.holdfast.invalid"]);
  });

  it("同一人先 Google 後 LINE（同一個真實 email）成為兩位會員，不自動合併", async () => {
    const google = await loginWith("google", {
      sub: "g-1",
      email: "same@example.com",
      email_verified: true,
      name: "Same",
    });
    const line = await loginWith("line", { sub: "U1", email: "same@example.com", name: "Same" });

    expect(line.sessionCookie).toBeDefined();
    expect(await userEmails()).toEqual(["line-u1@members.holdfast.invalid", "same@example.com"]);
    const [googleMember, lineMember] = await Promise.all([
      memberOf(google.sessionCookie!),
      memberOf(line.sessionCookie!),
    ]);
    expect(googleMember!.memberId).not.toBe(lineMember!.memberId);
  });

  it("同一人先 LINE 後 Google（同一個真實 email）同樣成為兩位會員", async () => {
    await loginWith("line", { sub: "U1", email: "same@example.com", name: "Same" });
    const google = await loginWith("google", {
      sub: "g-1",
      email: "same@example.com",
      email_verified: true,
      name: "Same",
    });

    expect(google.sessionCookie).toBeDefined();
    expect(await userEmails()).toEqual(["line-u1@members.holdfast.invalid", "same@example.com"]);
  });

  it("同一個 LINE 身分再次登入回到同一位會員", async () => {
    const first = await loginWith("line", { sub: "U1", name: "Dan" });
    const second = await loginWith("line", { sub: "U1", name: "Dan" });

    expect(await userEmails()).toEqual(["line-u1@members.holdfast.invalid"]);
    expect((await memberOf(second.sessionCookie!))!.memberId).toBe(
      (await memberOf(first.sessionCookie!))!.memberId,
    );
  });
});

describe("帳號連結關閉", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  // 單靠 accountLinking 關閉就足以擋下 email 合併：Google 的 email 是已驗證的，
  // 所以不是「未驗證 email 不信任」這條規則擋的
  it("同一個 email、不同 Google 身分再登入：被拒絕，不併入第一位會員", async () => {
    await loginWith("google", {
      sub: "g-1",
      email: "same@example.com",
      email_verified: true,
      name: "First",
    });
    const second = await loginWith("google", {
      sub: "g-2",
      email: "same@example.com",
      email_verified: true,
      name: "Second",
    });

    expect(second.sessionCookie).toBeUndefined();
    expect(second.location).toContain("account_not_linked");
    expect(await userEmails()).toEqual(["same@example.com"]);
    const accounts = await env.DB.prepare("SELECT COUNT(*) AS n FROM account").first<{ n: number }>();
    expect(accounts!.n).toBe(1);
  });
});

describe("session", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("沒有 cookie 或 cookie 無效時不是會員", async () => {
    expect(await app.getMemberSession("")).toEqual({ member: null, setCookies: [] });
    expect(await app.getMemberSession("better-auth.session_token=bogus")).toEqual({
      member: null,
      setCookies: [],
    });
  });

  it("只回傳 Web 需要的欄位，不含 session token", async () => {
    const login = await loginWith("google", {
      sub: "g-1",
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    });

    const member = await memberOf(login.sessionCookie!);
    expect(Object.keys(member!).sort()).toEqual(["expiresAt", "memberId", "name"]);
    expect(typeof member!.expiresAt).toBe("number");
  });

  it("session 逾 updateAge 被延長時，RPC 一併回傳要送給瀏覽器的 Set-Cookie", async () => {
    const login = await loginWith("google", { sub: "g-1", email: "a@example.com", name: "Alice" });
    const fresh = await app.getMemberSession(login.sessionCookie!);
    expect(fresh.setCookies).toEqual([]);

    // 把到期日拉近到超過 1 天（預設 updateAge）沒有延長的程度
    const nearExpiry = Date.now() + 5 * 24 * 3600_000;
    await env.DB.prepare("UPDATE session SET expires_at = ?").bind(nearExpiry).run();

    const refreshed = await app.getMemberSession(login.sessionCookie!);
    expect(refreshed.member).not.toBeNull();
    expect(refreshed.setCookies.some((c: string) => c.startsWith("better-auth.session_token="))).toBe(true);
    expect(refreshed.member!.expiresAt).toBeGreaterThan(nearExpiry);
  });

  it("登出後 session 失效，且只刪除該會員的 session", async () => {
    const alice = await loginWith("google", { sub: "g-1", email: "a@example.com", name: "Alice" });
    const bob = await loginWith("line", { sub: "U2", name: "Bob" });
    expect(await sessionCount()).toBe(2);

    const response = await app.fetch(
      new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie: alice.sessionCookie!, origin: ORIGIN },
      }),
    );

    expect(response.status).toBe(200);
    expect(await memberOf(alice.sessionCookie!)).toBeNull();
    expect(await memberOf(bob.sessionCookie!)).not.toBeNull();
    expect(await sessionCount()).toBe(1);
  });
});

describe("App Worker 的 HTTP 入口", () => {
  it("只處理 /api/auth/，其他路徑一律 404", async () => {
    const response = await app.fetch(new Request(`${ORIGIN}/admin`));
    expect(response.status).toBe(404);
  });
});
