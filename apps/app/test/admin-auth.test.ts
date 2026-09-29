import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateRogueKey, mintAccessJwt } from "./access";
import { setNow } from "./clock";
import { countRows, insertResource, resetDb } from "./db";

const NOW = Date.UTC(2030, 0, 1);
const NOW_SECONDS = NOW / 1000;
const UNAUTHORIZED = { ok: false, reason: "unauthorized" };

const app = exports.default;

// 每個管理 RPC 方法都必須先驗 JWT；用合法輸入呼叫，確保拒絕的原因只可能是身分
async function adminCalls(jwt: string) {
  const resourceId = await insertResource({ name: "既有資源" });
  const resource = { name: "新資源", seatsPerHold: 4, cancellationCutoffSeconds: 3600 };
  return {
    createResource: () => app.createResource(jwt, resource),
    updateResource: () => app.updateResource(jwt, { id: resourceId, holdTtlSeconds: 600, ...resource }),
    listResourcesForAdmin: () => app.listResourcesForAdmin(jwt),
    createSlot: () =>
      app.createSlot(jwt, { resourceId, startsAt: NOW + 1000, endsAt: NOW + 2000, capacity: 5 }),
  };
}

async function expectAllRejected(jwt: string) {
  await resetDb();
  const calls = await adminCalls(jwt);
  for (const [name, call] of Object.entries(calls)) {
    expect(await call(), name).toEqual(UNAUTHORIZED);
  }
  // 拒絕之後沒有任何寫入（只有 adminCalls 預先建立的那一筆資源）
  expect(await countRows("resources")).toBe(1);
  expect(await countRows("slots")).toBe(0);
  expect(await countRows("admin_audit")).toBe(0);
}

describe("管理 RPC 的 Access JWT 驗證", () => {
  beforeEach(async () => {
    await resetDb();
    setNow(NOW);
  });

  it("合法的 JWT 通過", async () => {
    const result = await app.listResourcesForAdmin(await mintAccessJwt());
    expect(result.ok).toBe(true);
  });

  it("沒有 JWT（空字串）被拒絕", async () => {
    await expectAllRejected("");
  });

  it("偽造的 header 值（純 email、亂字串、未簽章 JSON）被拒絕", async () => {
    await expectAllRejected("admin@example.com");
    await expectAllRejected("not-a-jwt");
    const unsigned =
      btoa(JSON.stringify({ alg: "none" })) + "." +
      btoa(JSON.stringify({ email: "admin@example.com", aud: env.ACCESS_AUD })) + ".";
    await expectAllRejected(unsigned);
  });

  it("簽章無效（用別把金鑰簽）被拒絕", async () => {
    await expectAllRejected(await mintAccessJwt({ key: await generateRogueKey() }));
  });

  it("alg 不是 RS256（HS256）被拒絕", async () => {
    const secret = new TextEncoder().encode("x".repeat(32));
    const hmac = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    await expectAllRejected(await mintAccessJwt({ key: hmac, alg: "HS256" }));
  });

  it("aud 不符被拒絕", async () => {
    await expectAllRejected(await mintAccessJwt({ aud: "another-app" }));
  });

  it("iss 不符被拒絕", async () => {
    await expectAllRejected(await mintAccessJwt({ iss: "https://evil.cloudflareaccess.com" }));
  });

  it("已過期被拒絕；以注入的 Clock 判斷，exp 恰等於現在也算過期", async () => {
    await expectAllRejected(await mintAccessJwt({ iat: NOW_SECONDS - 7200, exp: NOW_SECONDS - 3600 }));
    await expectAllRejected(await mintAccessJwt({ iat: NOW_SECONDS - 7200, exp: NOW_SECONDS }));

    const jwt = await mintAccessJwt({ exp: NOW_SECONDS + 60 });
    expect((await app.listResourcesForAdmin(jwt)).ok).toBe(true);
    setNow(NOW + 61_000); // 快轉到 JWT 過期之後
    expect(await app.listResourcesForAdmin(jwt)).toEqual(UNAUTHORIZED);
  });

  it("沒有 email claim 被拒絕（無法記錄操作者）", async () => {
    await expectAllRejected(await mintAccessJwt({ email: null }));
  });
});

describe("Access 設定缺漏時 fail closed", () => {
  const original = { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, jwks: env.ACCESS_JWKS_JSON };

  beforeEach(async () => {
    await resetDb();
    setNow(NOW);
  });
  afterEach(() => {
    env.ACCESS_TEAM_DOMAIN = original.teamDomain;
    env.ACCESS_AUD = original.aud;
    env.ACCESS_JWKS_JSON = original.jwks;
  });

  it("ACCESS_AUD 為空時，即使 JWT 完全合法也拒絕", async () => {
    const jwt = await mintAccessJwt();
    env.ACCESS_AUD = "";
    await expectAllRejected(jwt);
  });

  it("ACCESS_TEAM_DOMAIN 為空時拒絕", async () => {
    const jwt = await mintAccessJwt();
    env.ACCESS_TEAM_DOMAIN = "";
    await expectAllRejected(jwt);
  });

  it("ACCESS_JWKS_JSON 內容損毀時拒絕", async () => {
    const jwt = await mintAccessJwt();
    env.ACCESS_JWKS_JSON = "{not json";
    await expectAllRejected(jwt);
  });
});

describe("沒有內嵌 JWKS 時抓取 Access certs 端點", () => {
  const jwks = env.ACCESS_JWKS_JSON;

  beforeEach(async () => {
    await resetDb();
    setNow(NOW);
  });
  afterEach(() => {
    env.ACCESS_JWKS_JSON = jwks;
    vi.restoreAllMocks();
  });

  it("從 https://<team>/cdn-cgi/access/certs 取金鑰驗簽，並快取而不是每次都抓", async () => {
    env.ACCESS_JWKS_JSON = undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(jwks));
    const jwt = await mintAccessJwt();

    expect((await app.listResourcesForAdmin(jwt)).ok).toBe(true);
    expect((await app.listResourcesForAdmin(jwt)).ok).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  });
});
