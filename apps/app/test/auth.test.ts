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
    expect(await app.getMemberSession(login.sessionCookie!)).toMatchObject({ name: "Alice" });
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
      app.getMemberSession(google.sessionCookie!),
      app.getMemberSession(line.sessionCookie!),
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
    expect((await app.getMemberSession(second.sessionCookie!))!.memberId).toBe(
      (await app.getMemberSession(first.sessionCookie!))!.memberId,
    );
  });
});

describe("session", () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it("沒有 cookie 或 cookie 無效時不是會員", async () => {
    expect(await app.getMemberSession("")).toBeNull();
    expect(await app.getMemberSession("better-auth.session_token=bogus")).toBeNull();
  });

  it("只回傳 Web 需要的欄位，不含 session token", async () => {
    const login = await loginWith("google", {
      sub: "g-1",
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
    });

    const member = await app.getMemberSession(login.sessionCookie!);
    expect(Object.keys(member!).sort()).toEqual(["expiresAt", "memberId", "name"]);
    expect(typeof member!.expiresAt).toBe("number");
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
    expect(await app.getMemberSession(alice.sessionCookie!)).toBeNull();
    expect(await app.getMemberSession(bob.sessionCookie!)).not.toBeNull();
    expect(await sessionCount()).toBe(1);
  });
});

describe("App Worker 的 HTTP 入口", () => {
  it("只處理 /api/auth/，其他路徑一律 404", async () => {
    const response = await app.fetch(new Request(`${ORIGIN}/admin`));
    expect(response.status).toBe(404);
  });
});
