import { describe, expect, it } from "vitest";
import { readAccessJwt } from "./access-jwt";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://example.com/admin", { headers });

describe("讀取要轉交給 App 的 Access JWT", () => {
  it("有 Cf-Access-Jwt-Assertion header 就原樣轉交，不解析也不判斷", () => {
    expect(readAccessJwt(request({ "Cf-Access-Jwt-Assertion": "a.b.c" }), {})).toBe("a.b.c");
  });

  it("header 存在時，即使設了 ACCESS_DEV_JWT 也以 header 為準", () => {
    expect(
      readAccessJwt(request({ "Cf-Access-Jwt-Assertion": "from-header" }), { ACCESS_DEV_JWT: "dev" }),
    ).toBe("from-header");
  });

  it("沒有 header 時，才用本機開發的 ACCESS_DEV_JWT", () => {
    expect(readAccessJwt(request(), { ACCESS_DEV_JWT: "dev" })).toBe("dev");
  });

  it("兩者都沒有回傳空字串（App 會拒絕）", () => {
    expect(readAccessJwt(request(), {})).toBe("");
    expect(readAccessJwt(request(), { ACCESS_DEV_JWT: "" })).toBe("");
  });
});
