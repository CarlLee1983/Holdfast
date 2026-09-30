import { describe, expect, it } from "vitest";
import { bookingCancellation, cancellationRuleText } from "./cancellation";

const cutoff = 1000;

describe("bookingCancellation", () => {
  it("已確認且早於取消截止時間為可取消", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff - 1)).toBe("cancellable");
  });

  it("已確認且剛好等於取消截止時間仍可取消", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff)).toBe("cancellable");
  });

  it("已確認且晚於取消截止時間為已過截止", () => {
    expect(bookingCancellation({ status: "confirmed", cancellableUntil: cutoff }, cutoff + 1)).toBe("past-cutoff");
  });

  it("已取消（會員取消或管理者取消）不適用，與是否過截止無關", () => {
    expect(bookingCancellation({ status: "cancelled", cancellableUntil: cutoff }, cutoff - 1)).toBe("not-applicable");
    expect(bookingCancellation({ status: "cancelled", cancellableUntil: cutoff }, cutoff + 1)).toBe("not-applicable");
  });
});

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
