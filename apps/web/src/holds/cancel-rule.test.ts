import { describe, expect, it } from "vitest";
import { cancellationRuleText } from "./cancel-rule";

describe("cancellationRuleText", () => {
  it("整小時以小時表示", () => {
    expect(cancellationRuleText(7200)).toBe("可於用餐前 2 小時前自行取消");
    expect(cancellationRuleText(3600)).toBe("可於用餐前 1 小時前自行取消");
  });

  it("超過一天仍以小時表示", () => {
    expect(cancellationRuleText(86_400)).toBe("可於用餐前 24 小時前自行取消");
  });

  it("不足一小時以分鐘表示", () => {
    expect(cancellationRuleText(1800)).toBe("可於用餐前 30 分鐘前自行取消");
    expect(cancellationRuleText(60)).toBe("可於用餐前 1 分鐘前自行取消");
  });

  it("小時加分鐘", () => {
    expect(cancellationRuleText(5400)).toBe("可於用餐前 1 小時 30 分鐘前自行取消");
  });

  it("不足整分鐘的秒數進位到分鐘，不讓顧客誤以為還來得及", () => {
    expect(cancellationRuleText(61)).toBe("可於用餐前 2 分鐘前自行取消");
    expect(cancellationRuleText(1)).toBe("可於用餐前 1 分鐘前自行取消");
  });

  it("截止時間為 0 時，開始前都可取消", () => {
    expect(cancellationRuleText(0)).toBe("開始用餐前都可自行取消");
  });
});
