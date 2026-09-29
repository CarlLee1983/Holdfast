import { describe, expect, it } from "vitest";
import { isAuthPath, loginUrl, safeNextPath } from "./member";

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
  it("站內相對路徑原樣保留（含查詢字串）", () => {
    expect(safeNextPath("/reserve?slot=3")).toBe("/reserve?slot=3");
  });

  it.each([
    ["缺少", null],
    ["空字串", ""],
    ["外部網址", "https://evil.example/"],
    ["protocol-relative", "//evil.example/"],
    ["反斜線繞過", "/\\evil.example"],
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
