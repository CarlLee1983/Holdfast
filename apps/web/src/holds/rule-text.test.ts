import { describe, expect, it } from "vitest";
import { durationText, holdTtlRuleText } from "./rule-text";

describe("durationText", () => {
  it("不足一小時以分鐘表示", () => {
    expect(durationText(600)).toBe("10 分鐘");
    expect(durationText(60)).toBe("1 分鐘");
  });

  it("整小時以小時表示，超過一天仍以小時表示", () => {
    expect(durationText(3600)).toBe("1 小時");
    expect(durationText(86_400)).toBe("24 小時");
  });

  it("小時加分鐘", () => {
    expect(durationText(5400)).toBe("1 小時 30 分鐘");
  });

  it("不足整分鐘的秒數進位到分鐘", () => {
    expect(durationText(1)).toBe("1 分鐘");
    expect(durationText(61)).toBe("2 分鐘");
  });
});

describe("holdTtlRuleText", () => {
  it("依資源的保留期限產生須知文字", () => {
    expect(holdTtlRuleText(600)).toBe("保留 10 分鐘，逾時自動釋放");
    expect(holdTtlRuleText(3600)).toBe("保留 1 小時，逾時自動釋放");
  });

  it("不足整分鐘的秒數同樣進位到分鐘（與取消截止共用換算）", () => {
    expect(holdTtlRuleText(601)).toBe("保留 11 分鐘，逾時自動釋放");
  });
});
