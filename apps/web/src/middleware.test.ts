import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  fetch: vi.fn<(request: Request) => Promise<Response>>(),
  getMemberSession: vi.fn<(cookie: string) => Promise<unknown>>(),
}));

vi.mock("cloudflare:workers", () => ({ env: { APP: app } }));
vi.mock("astro:middleware", () => ({ defineMiddleware: <T>(handler: T) => handler }));

const { onRequest } = await import("./middleware");

const SESSION_COOKIE = "better-auth.session_token=tok.sig";

async function run(url: string, init: RequestInit = {}, next = async () => new Response("page")) {
  const locals: Record<string, unknown> = {};
  const request = new Request(url, init);
  const context = { request, url: new URL(url), locals };
  const handler = onRequest as unknown as (
    context: unknown,
    next: () => Promise<Response>,
  ) => Promise<Response>;
  const response = await handler(context, next);
  return { response, locals };
}

beforeEach(() => {
  app.fetch.mockReset();
  app.getMemberSession.mockReset();
  vi.restoreAllMocks();
});

describe("/api/auth/* 轉發", () => {
  it("302、Location 與多個 Set-Cookie 原樣回給瀏覽器", async () => {
    const forwarded = new Response(null, { status: 302, headers: { location: "/" } });
    forwarded.headers.append("set-cookie", "better-auth.session_token=a; Path=/; HttpOnly");
    forwarded.headers.append("set-cookie", "better-auth.session_data=b; Path=/; HttpOnly");
    app.fetch.mockResolvedValue(forwarded);

    const { response } = await run("https://holdfast.example/api/auth/callback/line?code=1");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=a; Path=/; HttpOnly",
      "better-auth.session_data=b; Path=/; HttpOnly",
    ]);
  });

  it("以 redirect: manual 轉發，method、body 與 Origin 不變，且不查 session", async () => {
    app.fetch.mockResolvedValue(new Response("{}"));

    await run("https://holdfast.example/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://holdfast.example", cookie: SESSION_COOKIE },
      body: "{}",
    });

    const forwarded = app.fetch.mock.calls[0]![0];
    expect(forwarded.redirect).toBe("manual");
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("origin")).toBe("https://holdfast.example");
    expect(forwarded.headers.get("cookie")).toBe(SESSION_COOKIE);
    expect(app.getMemberSession).not.toHaveBeenCalled();
  });
});

describe("/api/auth/* 轉發的來源 IP 標頭", () => {
  it("不轉送用戶端帶的 X-Forwarded-*，並帶上 Web 收到的 cf-connecting-ip", async () => {
    app.fetch.mockResolvedValue(new Response("{}"));

    await run("https://holdfast.example/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "http",
        origin: "https://holdfast.example",
      },
      body: "{}",
    });

    const forwarded = app.fetch.mock.calls[0]![0];
    expect(forwarded.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect([...forwarded.headers.keys()].filter((name) => name.startsWith("x-forwarded-"))).toEqual([]);
    expect(forwarded.headers.get("origin")).toBe("https://holdfast.example");
  });

  it("Web 沒收到 cf-connecting-ip 時，也不會有人為指定的來源 IP 標頭", async () => {
    app.fetch.mockResolvedValue(new Response("{}"));

    await run("https://holdfast.example/api/auth/sign-out", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.1" },
      body: "{}",
    });

    const forwarded = app.fetch.mock.calls[0]![0];
    expect(forwarded.headers.has("cf-connecting-ip")).toBe(false);
    expect(forwarded.headers.has("x-forwarded-for")).toBe(false);
  });
});

describe("會員 session 放進 locals", () => {
  it("沒有 Better Auth session cookie 時不呼叫 RPC（別的 cookie 也不算）", async () => {
    const { locals } = await run("https://holdfast.example/", { headers: { cookie: "theme=dark" } });

    expect(app.getMemberSession).not.toHaveBeenCalled();
    expect(locals["member"]).toBeNull();
  });

  it("有 session cookie 時把 RPC 的會員放進 locals", async () => {
    const member = { memberId: "m1", name: "Alice", expiresAt: 1 };
    app.getMemberSession.mockResolvedValue({ member, setCookies: [] });

    const { locals } = await run("https://holdfast.example/", { headers: { cookie: SESSION_COOKIE } });

    expect(app.getMemberSession).toHaveBeenCalledWith(SESSION_COOKIE);
    expect(locals["member"]).toEqual(member);
  });

  it("session 被延長時，RPC 回的 Set-Cookie 附加到頁面回應", async () => {
    app.getMemberSession.mockResolvedValue({
      member: { memberId: "m1", name: "Alice", expiresAt: 1 },
      setCookies: ["better-auth.session_token=new; Max-Age=604800; Path=/", "better-auth.session_data=x; Path=/"],
    });

    const { response } = await run(
      "https://holdfast.example/",
      { headers: { cookie: SESSION_COOKIE } },
      async () => new Response("page", { headers: { "set-cookie": "other=1" } }),
    );

    expect(await response.text()).toBe("page");
    expect(response.headers.getSetCookie()).toEqual([
      "other=1",
      "better-auth.session_token=new; Max-Age=604800; Path=/",
      "better-auth.session_data=x; Path=/",
    ]);
  });

  it("RPC 丟例外時記一行結構化 log，當作未登入，公開頁面照常回應", async () => {
    app.getMemberSession.mockRejectedValue(new Error("app down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { response, locals } = await run("https://holdfast.example/", {
      headers: { cookie: SESSION_COOKIE },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("page");
    expect(locals["member"]).toBeNull();
    const line = JSON.parse(log.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ event: "member_session_lookup_failed", error: "app down" });
  });
});
