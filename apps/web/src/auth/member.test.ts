import { describe, expect, it } from "vitest";
import { hasSessionCookie, isAuthPath, loginUrl, safeNextPath } from "./member";

describe("isAuthPath", () => {
  it("只有 /api/auth/ 底下的路徑要轉給 App Worker", () => {
    expect(isAuthPath("/api/auth/sign-in/social")).toBe(true);
    expect(isAuthPath("/api/auth/callback/line")).toBe(true);
    expect(isAuthPath("/api/auth")).toBe(false);
    expect(isAuthPath("/api/authors")).toBe(false);
    expect(isAuthPath("/admin")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("站內相對路徑原樣保留（含查詢字串與 hash）", () => {
    expect(safeNextPath("/reserve?slot=3")).toBe("/reserve?slot=3");
    expect(safeNextPath("/reserve?slot=3#top")).toBe("/reserve?slot=3#top");
  });

  it("所有可通過的結果都是站內路徑（解析後 origin 不變）", () => {
    for (const value of ["/a", "/a/../b", "/a?next=//evil.example", "/%2F/evil.example"]) {
      const result = safeNextPath(value);
      expect(new URL(result, "https://holdfast.example").origin).toBe("https://holdfast.example");
    }
  });

  it.each([
    ["缺少", null],
    ["空字串", ""],
    ["外部網址", "https://evil.example/"],
    ["protocol-relative", "//evil.example/"],
    ["反斜線繞過", "/\\evil.example"],
    ["tab 被 URL 解析器吃掉（/%09/evil.example）", "/\t/evil.example"],
    ["換行被 URL 解析器吃掉（%0a）", "/\n/evil.example"],
    ["歸位字元被 URL 解析器吃掉（%0d）", "/\r/evil.example"],
    ["javascript: 網址", "javascript:alert(1)"],
    ["不是以斜線開頭", "reserve"],
  ])("%s 一律退回首頁，避免 open redirect", (_label, value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

describe("loginUrl", () => {
  it("未登入訪客被引導到登入頁，並帶著原本要去的路徑", () => {
    expect(loginUrl(new URL("https://holdfast.example/reserve?slot=3"))).toBe(
      "/login?next=%2Freserve%3Fslot%3D3",
    );
  });
});

describe("hasSessionCookie", () => {
  it("有 Better Auth 的 session cookie（含 __Secure- 前綴）才算", () => {
    expect(hasSessionCookie("better-auth.session_token=abc.def")).toBe(true);
    expect(hasSessionCookie("a=b; __Secure-better-auth.session_token=abc")).toBe(true);
  });

  it("其他 cookie 或 state cookie 不算", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("theme=dark")).toBe(false);
    expect(hasSessionCookie("better-auth.state=xyz")).toBe(false);
    expect(hasSessionCookie("x-better-auth.session_token_lookalike=1")).toBe(false);
  });
});
