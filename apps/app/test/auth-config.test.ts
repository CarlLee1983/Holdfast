import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "../src/auth/config";
import { checkAuthDeploy, parseSecretList } from "../src/auth/deploy-check";

const VALID = {
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  BETTER_AUTH_URL: "http://localhost:4321",
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  LINE_CHANNEL_ID: "line-id",
  LINE_CHANNEL_SECRET: "line-secret",
};

describe("parseAuthConfig", () => {
  it("測試環境的 binding 是完整的設定", () => {
    expect(() => parseAuthConfig(env)).not.toThrow();
  });

  it("完整設定解析成 AuthConfig", () => {
    expect(parseAuthConfig(VALID)).toEqual({
      baseURL: "http://localhost:4321",
      secret: VALID.BETTER_AUTH_SECRET,
      google: { clientId: "google-id", clientSecret: "google-secret" },
      line: { clientId: "line-id", clientSecret: "line-secret" },
    });
  });

  it.each(Object.keys(VALID))("缺少 %s 時明確失敗並指出變數名稱", (name) => {
    const { [name]: _removed, ...rest } = VALID as Record<string, string>;
    expect(() => parseAuthConfig(rest)).toThrow(name);
  });

  it("空字串視同缺少", () => {
    expect(() => parseAuthConfig({ ...VALID, LINE_CHANNEL_SECRET: "" })).toThrow("LINE_CHANNEL_SECRET");
  });

  it("BETTER_AUTH_SECRET 短於 32 字元視為無效", () => {
    expect(() => parseAuthConfig({ ...VALID, BETTER_AUTH_SECRET: "short" })).toThrow(
      "BETTER_AUTH_SECRET",
    );
  });

  it("一次列出所有缺少的變數，且錯誤訊息不含設定值", () => {
    let message = "";
    try {
      parseAuthConfig({ BETTER_AUTH_URL: "http://localhost:4321", GOOGLE_CLIENT_ID: "secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const name of [
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "LINE_CHANNEL_ID",
      "LINE_CHANNEL_SECRET",
    ]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain("secret-value");
  });
});

describe("checkAuthDeploy（部署前檢查）", () => {
  const ALL_SECRETS = [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "LINE_CHANNEL_ID",
    "LINE_CHANNEL_SECRET",
  ];
  const PREVIEW_URL = "https://holdfast-preview.gravito.dev";
  const PRODUCTION_URL = "https://holdfast.gravito.dev";

  it("URL 是該環境的 Web 網域、secrets 齊全時沒有問題", () => {
    expect(
      checkAuthDeploy({ deployEnv: "preview", authUrl: PREVIEW_URL, secretNames: ALL_SECRETS }),
    ).toEqual([]);
    expect(
      checkAuthDeploy({ deployEnv: "production", authUrl: PRODUCTION_URL, secretNames: ALL_SECRETS }),
    ).toEqual([]);
  });

  it("BETTER_AUTH_URL 空字串或未宣告都算缺", () => {
    for (const authUrl of ["", undefined]) {
      expect(checkAuthDeploy({ deployEnv: "preview", authUrl, secretNames: ALL_SECRETS })).toEqual([
        "缺少 BETTER_AUTH_URL",
      ]);
    }
  });

  it("BETTER_AUTH_URL 不等於該環境的 Web 網域時指出期望值", () => {
    for (const authUrl of [
      PRODUCTION_URL, // 貼到別的環境
      "http://localhost:4321",
      `${PREVIEW_URL}/`, // 結尾斜線會讓 redirect_uri 對不上
      "https://holdfast-preview.gravito.dev:8443",
    ]) {
      expect(checkAuthDeploy({ deployEnv: "preview", authUrl, secretNames: ALL_SECRETS })).toEqual([
        `BETTER_AUTH_URL 應為 ${PREVIEW_URL}，目前是 ${authUrl}`,
      ]);
    }
  });

  it("列出所有沒有設定的 secret", () => {
    expect(
      checkAuthDeploy({
        deployEnv: "production",
        authUrl: PRODUCTION_URL,
        secretNames: ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID"],
      }),
    ).toEqual(["缺少 GOOGLE_CLIENT_SECRET", "缺少 LINE_CHANNEL_ID", "缺少 LINE_CHANNEL_SECRET"]);
  });

  it("與 parseAuthConfig 要求的 secrets 是同一份清單", () => {
    expect(
      checkAuthDeploy({ deployEnv: "production", authUrl: PRODUCTION_URL, secretNames: [] }),
    ).toEqual(ALL_SECRETS.map((name) => `缺少 ${name}`));
  });
});

describe("parseSecretList（wrangler secret list --format json）", () => {
  it("取出 secret 名稱，忽略其他欄位", () => {
    expect(
      parseSecretList('[{"name":"BETTER_AUTH_SECRET","type":"secret_text"},{"name":"LINE_CHANNEL_ID"}]'),
    ).toEqual(["BETTER_AUTH_SECRET", "LINE_CHANNEL_ID"]);
    expect(parseSecretList("[]")).toEqual([]);
  });

  it.each([
    ["不是 JSON", "Error: not logged in"],
    ["不是陣列", '{"name":"X"}'],
    ["元素沒有 name", '[{"id":"X"}]'],
    ["name 不是字串", '[{"name":1}]'],
  ])("%s：丟出錯誤，不當作沒有 secret", (_label, output) => {
    expect(() => parseSecretList(output)).toThrow();
  });
});
